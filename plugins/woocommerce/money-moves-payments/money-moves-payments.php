<?php
/**
 * Plugin Name:       Money Moves Payments
 * Plugin URI:        https://docs.usemoneymoves.xyz/woocommerce
 * Description:       Take payments by bank transfer, the Money Moves app or stablecoins (USDC and USDT) in your WooCommerce store, and get paid to your bank account, Money Moves account or business wallet the moment each order is paid.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Money Moves
 * Author URI:        https://usemoneymoves.xyz
 * License:           MIT
 * Text Domain:       money-moves-payments
 * WC requires at least: 7.0
 * WC tested up to:   9.4
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MONEY_MOVES_WC_VERSION', '1.0.0');
define('MONEY_MOVES_WC_FILE', __FILE__);

// Works with WooCommerce's order tables (HPOS) and the block checkout.
add_action('before_woocommerce_init', function () {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
    }
});

add_action('plugins_loaded', function () {
    if (!class_exists('WC_Payment_Gateway')) {
        add_action('admin_notices', function () {
            echo '<div class="notice notice-error"><p>' . esc_html__('Money Moves Payments needs WooCommerce. Install and activate WooCommerce first.', 'money-moves-payments') . '</p></div>';
        });
        return;
    }
    require_once __DIR__ . '/lib/MoneyMoves.php';
    require_once __DIR__ . '/includes/class-money-moves-gateway.php';
    add_filter('woocommerce_payment_gateways', function ($gateways) {
        $gateways[] = 'Money_Moves_Gateway';
        return $gateways;
    });
});

// The block checkout: Money Moves listed as a way to pay, redirecting like the classic checkout.
add_action('woocommerce_blocks_loaded', function () {
    if (!class_exists(\Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType::class)) {
        return;
    }
    require_once __DIR__ . '/includes/class-money-moves-blocks.php';
    add_action('woocommerce_blocks_payment_method_type_registration', function ($registry) {
        $registry->register(new Money_Moves_Blocks());
    });
});

// A Settings link on the Plugins page.
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    $url = admin_url('admin.php?page=wc-settings&tab=checkout&section=money_moves');
    array_unshift($links, '<a href="' . esc_url($url) . '">' . esc_html__('Settings', 'money-moves-payments') . '</a>');
    return $links;
});
