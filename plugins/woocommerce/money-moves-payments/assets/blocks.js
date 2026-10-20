/* Money Moves in the block checkout: its name, its line, and an icon. Paying redirects, like the classic checkout. */
(function () {
  var registry = window.wc && window.wc.wcBlocksRegistry
  var settings = (window.wc && window.wc.wcSettings && window.wc.wcSettings.getSetting('money_moves_data', {})) || {}
  if (!registry || !window.wp || !window.wp.element) return
  var el = window.wp.element.createElement
  var decode = (window.wp.htmlEntities && window.wp.htmlEntities.decodeEntities) || function (s) { return s }
  var title = decode(settings.title || 'Bank transfer, Money Moves or crypto')
  var Label = function () {
    return el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, settings.icon ? el('img', { src: settings.icon, alt: '', style: { height: '20px' } }) : null, title)
  }
  var Content = function () {
    return el('p', null, decode(settings.description || ''))
  }
  registry.registerPaymentMethod({
    name: 'money_moves',
    label: el(Label),
    content: el(Content),
    edit: el(Content),
    canMakePayment: function () { return true },
    ariaLabel: title,
    supports: { features: ['products'] },
  })
})()
