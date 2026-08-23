import { describe, expect, it } from 'vitest'

// 沙箱与 SSRF 校验测试(不发起网络请求; URL 校验先于 fetch)
const { runParse, runExtractor, evalJsResponse, resolvePath, fetchBalance, EXTRACT_TIMEOUT_MS } =
  await import('../lib/fetcher.js')

describe('fetcher.runParse 单函数模型(安全 eval)', () => {
  it('JSON 响应解析', () => {
    const v = runParse('{"balance": 3.14}', 'function (raw) { return JSON.parse(raw).balance }')
    expect(v).toBeCloseTo(3.14)
  })

  it('函数内允许使用标准 eval/Function (vm 内建)', () => {
    const v = runParse('whatever', 'function (raw) { return eval("40+2") }')
    expect(v).toBe(42)
  })

  it('语法错误 -> 中文错误信息', () => {
    expect(() => runParse('x', 'function (raw) { return ))) }')).toThrow(/解析函数执行失败/)
  })

  it('死循环 -> 脚本超时', () => {
    expect(() => runParse('x', 'function (raw) { for(;;){} }')).toThrow(
      new RegExp(`解析函数执行超时 \\(${EXTRACT_TIMEOUT_MS}ms\\)`),
    )
  }, 10_000)
})

describe('fetcher.runExtractor 提取函数(黑白名单 + vm 隔离)', () => {
  it('正常提取', () => {
    expect(runExtractor('function (data) { return data.quota / 2 }', { quota: 10 })).toBe(5)
  })

  it('禁止 require/process', () => {
    expect(() => runExtractor('function(d){ return require("fs") }', {})).toThrow(
      /提取函数包含禁止的 API: /,
    )
  })

  it('禁止 Function 构造器', () => {
    expect(() => runExtractor('new Function("return process.env")()', {})).toThrow(
      /提取函数包含禁止的 API/,
    )
  })

  it('constructor 逃逸链被黑名单拦截', () => {
    expect(() =>
      runExtractor('function(d){ return d.constructor.constructor("return process")() }', {}),
    ).toThrow(/提取函数包含禁止的 API: constructor/)
  })

  it('\\uXXXX 编码绕过被解码后拦截', () => {
    expect(() => runExtractor('function(d){ return d.\\u0063onstructor }', {})).toThrow(
      /提取函数包含禁止的 API: constructor/,
    )
  })

  it('白名单外标识符被拦截; 属性链放行', () => {
    expect(() => runExtractor('function(d){ return evilGlobal }', {})).toThrow(
      '使用了白名单外的标识符: evilGlobal',
    )
    // 现实预设风格: 属性链访问(与旧实现逐字一致, 含 indexOf 词法检查的历史行为)
    expect(
      runExtractor(
        'function (data) {\n  var infos = data.balance_infos\n  if (!infos || !infos.length) return null\n  return infos[0].total_balance\n}',
        { balance_infos: [{ total_balance: 5 }] },
      ),
    ).toBe(5)
  })

  it('逃逸不可达: 沙箱内无宿主 process', () => {
    // 即使绕过词法检查(白名单标识符), vm realm 中也拿不到宿主对象
    let leaked = false
    try {
      runExtractor(
        'function(d){ var g = d.constructor.constructor; return typeof g }',
        JSON.parse('{"a":1}'),
      )
    } catch {
      // 黑名单已拦
      leaked = false
    }
    expect(leaked).toBe(false)
  })
})

describe('fetcher.evalJsResponse JS 赋值式响应', () => {
  it('$R 协议求值', () => {
    const v = evalJsResponse(';0x1f;$R = { quota: 1234 };$R') as { quota: number }
    expect(v.quota).toBe(1234)
  })

  it('空文本报错', () => {
    expect(() => evalJsResponse('   ')).toThrow('响应不是有效 JSON')
  })
})

describe('fetcher.resolvePath', () => {
  it('嵌套取值/数组下标/缺失路径', () => {
    const data = { a: { b: [{ c: 5 }] } }
    expect(resolvePath(data, 'a.b[0].c')).toBe(5)
    expect(resolvePath(data, 'a.missing')).toBeUndefined()
    expect(resolvePath(null, 'a.b')).toBeUndefined()
  })
})

describe('fetchBalance URL 安全校验 (SSRF 防护, 默认拒绝内网)', () => {
  it('未配置请求 URL', async () => {
    await expect(fetchBalance({})).rejects.toThrow('未配置请求 URL')
  })

  it('非 http/https 协议拒绝', async () => {
    await expect(fetchBalance({ request: { url: 'ftp://example.com/x' } as never })).rejects.toThrow(
      '仅支持 http/https 请求',
    )
  })

  it.each([
    'http://127.0.0.1:9/x',
    'https://localhost/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/api',
    'http://192.168.1.2/api',
  ])('内网/环回/元数据地址被阻止: %s', async (url) => {
    await expect(fetchBalance({ request: { url } as never })).rejects.toThrow(
      /目标地址为环回\/内网地址，已阻止/,
    )
  })
})
