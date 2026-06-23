import 'dotenv/config'
import linebot from 'linebot'
import commandParkingCard from './commands/parkingCard.js'

// LINE BOT
const bot = linebot({
  channelId: process.env.CHANNEL_ID,
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
})

// 半正矢公式：根據兩點的經度和緯度來計算球面上兩點之間距離的計算方法
function getDistance(lat1, lon1, lat2, lon2) {
  // 地球半徑 (公尺)
  const R = 6371000
  const f1 = (lat1 * Math.PI) / 180
  const f2 = (lat2 * Math.PI) / 180
  const df = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(df / 2) * Math.sin(df / 2) +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// 記使用者停車位置
const userCars = {}
// 記對話狀態：「找車位」或「記車位」
const userStates = {}

// 1. TDX 臨時通行證 (Access Token)
async function getTdxToken() {
  const url = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token'
  const params = new URLSearchParams()
  params.append('grant_type', 'client_credentials')
  params.append('client_id', process.env.TDX_CLIENT_ID)
  params.append('client_secret', process.env.TDX_CLIENT_SECRET)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    if (!response.ok) throw new Error('TDX Token 取得失敗')
    const data = await response.json()
    return data.access_token
  } catch (error) {
    console.error('❌ TDX Token 授權發生錯誤：', error)
    return null
  }
}

// 2. 取得「指定縣市」的路邊停車位資料
async function getTdxParkingData(token, city = 'Taipei') {
  const headers = {
    accept: 'application/json',
    Authorization: `Bearer ${token}`,
  }

  // 靜態資料
  const staticUrl = `https://tdx.transportdata.tw/api/basic/v1/Parking/OnStreet/ParkingSpot/City/${city}?%24top=50000&%24format=JSON`
  // 動態資料
  const dynamicUrl = `https://tdx.transportdata.tw/api/basic/v1/Parking/OnStreet/ParkingSpotAvailability/City/${city}?%24top=50000&%24format=JSON`

  try {
    console.log(`🔄 正在取得「${city === 'Taipei' ? '台北市' : '新北市'}」API 資料...`)

    const [staticRes, dynamicRes] = await Promise.all([
      fetch(staticUrl, { headers }),
      fetch(dynamicUrl, { headers }),
    ])

    if (!staticRes.ok || !dynamicRes.ok) {
      console.error(`❌ API 資料請求失敗：靜態:${staticRes.status}, 動態:${dynamicRes.status}`)
      return null
    }

    const staticData = await staticRes.json()
    const dynamicData = await dynamicRes.json()

    const getArray = (data) => {
      if (Array.isArray(data)) return data
      const foundKey = Object.keys(data).find((key) => Array.isArray(data[key]))
      return foundKey ? data[foundKey] : []
    }

    const staticSpots = getArray(staticData)
    const dynamicStatuses = getArray(dynamicData)

    console.log(
      `🟢 成功取得「${city === 'Taipei' ? '台北市' : '新北市'}」API 資料 (靜態: ${staticSpots.length} 筆 / 動態: ${dynamicStatuses.length} 筆)`,
    )

    return { staticSpots, dynamicStatuses }
  } catch (error) {
    console.error(`❌ 取得 API 資料發生例外錯誤：`, error)
    return null
  }
}

// 3. 機器人事件監聽
bot.on('message', async (event) => {
  const userId = event.source.userId

  // 使用者傳送位置資訊找空車位
  if (event.message.type === 'location') {
    const userLat = event.message.latitude
    const userLon = event.message.longitude

    // 等待紀錄使用者停車位置
    if (userStates[userId] === 'waiting_for_parking_location') {
      const now = new Date()
      userCars[userId] = {
        lat: userLat,
        lon: userLon,
        time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
      }

      // 清除狀態，恢復正常狀態
      delete userStates[userId]

      return event.reply(
        '🟢 已成功記住您的停車位置！要回來牽車時，請點選「導航愛車位置」，我就會幫您一鍵導航囉～',
      )
    }

    const token = await getTdxToken()
    if (!token) return event.reply('⚠️ 系統暫時無法連線至伺服器，請稍後再試！')

    // 取得使用者發送的地址文字判斷縣市
    const userAddress = event.message.address || ''
    let targetCity = 'Taipei'

    if (userAddress.includes('新北市') || userAddress.includes('New Taipei')) {
      targetCity = 'NewTaipei'
    }

    const parkingData = await getTdxParkingData(token, targetCity)
    if (!parkingData) return event.reply('⚠️ 即時車位資料更新失敗，請稍後再試！')

    const { staticSpots, dynamicStatuses } = parkingData

    console.log('🔄 正在進行距離計算與篩選車位...')
    console.time('🟢 計算與篩選完成，耗時')

    // 建立 Map 快查索引
    const statusMap = new Map()
    dynamicStatuses.forEach((status) => {
      if (status.ParkingSpotID) {
        statusMap.set(status.ParkingSpotID, status.SpotStatus)
      }
    })

    // 篩選方圓 1.5 公里內的空車位
    const emptySpots = staticSpots
      .filter((spot) => {
        if (!spot.Position || !spot.Position.PositionLat) return false
        return (
          Math.abs(spot.Position.PositionLat - userLat) < 0.015 &&
          Math.abs(spot.Position.PositionLon - userLon) < 0.015
        )
      })
      .map((staticSpot) => {
        const spotStatus = statusMap.get(staticSpot.ParkingSpotID) || 0
        return { ...staticSpot, spotStatus }
      })
      .filter((spot) => spot.spotStatus === 2 || spot.spotStatus === '2')

    // 計算與使用者的真實距離
    const spotsWithDistance = emptySpots.map((spot) => {
      const distance = getDistance(
        userLat,
        userLon,
        spot.Position.PositionLat,
        spot.Position.PositionLon,
      )
      return {
        id: spot.ParkingSpotID,
        lat: spot.Position.PositionLat,
        lon: spot.Position.PositionLon,
        distance: Math.round(distance),
      }
    })

    // 避免重複提供同一個車位
    const seenIds = new Set()
    const uniqueSpots = spotsWithDistance.filter((spot) => {
      if (seenIds.has(spot.id)) return false
      seenIds.add(spot.id)
      return true
    })

    // 取前 3 名
    uniqueSpots.sort((a, b) => a.distance - b.distance)
    const top3 = uniqueSpots.slice(0, 3)

    console.timeEnd('🟢 計算與篩選完成，耗時')

    if (top3.length === 0) {
      return event.reply('😭 距離您提供的位置 1.5 公里內暫時沒有路邊空車位～')
    }

    // 印出卡片回覆
    return commandParkingCard(event, top3)
  }

  // 使用者傳送文字訊息
  if (event.message.type === 'text') {
    const userText = event.message.text.trim()

    // 記住停車位置
    if (userText.includes('記住停車位置') || userText.includes('記住車位')) {
      // 標記狀態：接下來傳送的位置資訊是用來「記車位」的，不是「找車位」
      userStates[userId] = 'waiting_for_parking_location'

      // 回覆 Quick Reply 膠囊按鈕，讓使用者一按就能直接分享位置
      return event.reply({
        type: 'text',
        text: '📍 我準備好幫您記車位了！請點選下方按鈕傳送您的停車位置：',
        quickReply: {
          items: [
            {
              type: 'action',
              action: {
                type: 'location',
                label: '傳送停車位置',
              },
            },
          ],
        },
      })
    }

    // 導航愛車位置
    if (userText === '導航愛車位置' || userText.includes('車停在哪')) {
      const carPos = userCars[userId]
      if (!carPos) {
        return event.reply('😭 找不到您的停車紀錄耶！剛剛停好車時有按「記住停車位置」嗎？')
      }

      const googleMapUrl = `https://www.google.com/maps/dir/?api=1&destination=${carPos.lat},${carPos.lon}`

      return event.reply(`🚘 開始導航至愛車位置：\n${googleMapUrl}\n\n🅿️ 停車時間：${carPos.time}`)
    }

    // 當使用者輸入非選單的文字時
    return event.reply('👇 請直接點選下方選單的「尋找空停車位」或「記住停車位置」傳送位置資訊喔！')
  }
})

bot.listen('/', process.env.PORT || 3000, () => {
  console.log('🚘 PAPAGO 一查即停：停車好幫手「趴狗」啟動')
})
