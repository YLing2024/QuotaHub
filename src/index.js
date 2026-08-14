const path = require('path')
const express = require('express')
const platformsRouter = require('./routes/platforms')
const presetsRouter = require('./routes/presets')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'public')))

app.use('/api/platforms', platformsRouter)
app.use('/api/presets', presetsRouter)

app.listen(PORT, () => {
  console.log(`QuotaHub 已启动: http://localhost:${PORT}`)
})
