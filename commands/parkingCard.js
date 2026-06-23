export default async (event, top3) => {
  const bubbles = top3.map((spot, index) => ({
    type: 'bubble',

    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `🅿️ 離您最近的路邊空車位 ${index + 1}`,
          weight: 'bold',
          size: 'md',
        },
      ],
    },

    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `        車格：${spot.id}`,
          size: 'sm',
        },
        {
          type: 'text',
          text: `        距離：${spot.distance} 公尺`,
          size: 'sm',
          margin: 'sm',
        },
      ],
    },

    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: {
            type: 'uri',
            label: '🚘 開始導航',
            uri: `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lon}`,
          },
        },
      ],
    },
  }))

  await event.reply({
    type: 'flex',
    altText: '🅿️ 離您最近的路邊空車位',
    contents: {
      type: 'carousel',
      contents: bubbles,
    },
  })
}
