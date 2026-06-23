export default () => ({
  type: 'bubble',

  header: {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'text',
        text: '🅿️ 離您最近的路邊空車位 1',
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
        text: '        車格：',
        size: 'sm',
      },
      {
        type: 'text',
        text: '        距離：0 公尺',
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
          size: 'sm',
          uri: 'https://www.google.com',
        },
      },
    ],
  },
})
