=== Money Moves Payments ===
Contributors: moneymoves
Tags: payments, bank transfer, stablecoins, usdc, woocommerce
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0.0
License: MIT

Take payments by bank transfer, the Money Moves app or stablecoins in WooCommerce, and get paid the moment each order is paid.

== Description ==

Money Moves Payments adds Money Moves to your checkout. Shoppers pay by bank transfer to a one-time account, with the Money Moves app, or with USDC or USDT from any wallet or exchange. You choose where the money goes: your bank account, your Money Moves account or your self-custodial business wallet.

* Orders are marked paid from Money Moves' signed webhook, and checked again when the shopper comes back.
* Works with the classic checkout and the block checkout, and with WooCommerce's order tables.
* Test mode simulates payments, so you can try every way to pay before going live.

Your store's currency must be NGN or USD.

== Installation ==

1. Upload the `money-moves-payments` folder to `/wp-content/plugins/`, or upload the zip from Plugins, Add New.
2. Activate it, then open WooCommerce, Settings, Payments, Money Moves.
3. Paste your test and live secret keys from your Money Moves dashboard, Developer portal, API keys.
4. In Developer portal, Webhooks, add the endpoint shown in the settings with the events `payment.successful` and `payment.underpaid`, and paste its signing secret.
5. Place a test order with test mode on. When it works, turn test mode off.

== Frequently Asked Questions ==

= Where does the money go? =

Where you choose in the plugin's settings, or your default from the Money Moves dashboard: your bank account, your Money Moves account or your business wallet.

= What if a shopper pays less than the order total? =

The order goes on hold with a note. Ask them for the rest, or refund them from your Money Moves dashboard.

== Changelog ==

= 1.0.0 =
* First release.
