import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readJson, writeJsonAtomic } from '../lib/storage.js'

const tmpDirs: string[] = []
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-storage-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('lib/storage JSON 读写', () => {
  it('readJson 文件缺失返回 fallback', () => {
    const file = path.join(tmpDir(), 'missing.json')
    expect(readJson(file, { fallback: true })).toEqual({ fallback: true })
  })

  it('readJson 损坏 JSON 返回 fallback', () => {
    const file = path.join(tmpDir(), 'broken.json')
    fs.writeFileSync(file, '{oops')
    expect(readJson<number[]>(file, [1, 2])).toEqual([1, 2])
  })

  it('writeJsonAtomic 原子写且不残留 .tmp', () => {
    const file = path.join(tmpDir(), 'cfg.json')
    writeJsonAtomic(file, { a: 1, list: [1, 2, 3] })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: 1, list: [1, 2, 3] })
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('writeJsonAtomic 自动创建目录并覆盖旧值', () => {
    const file = path.join(tmpDir(), 'deep/nested/cfg.json')
    writeJsonAtomic(file, { v: 1 })
    writeJsonAtomic(file, { v: 2 })
    expect(readJson<{ v: number }>(file, { v: 0 })).toEqual({ v: 2 })
  })
})
