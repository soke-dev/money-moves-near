<?php
/**
 * Money Moves in WooCommerce's block checkout: listed with its name and line,
 * and paid the same way as the classic checkout, by redirecting.
 */

if (!defined('ABSPATH')) {
    exit;
}

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class Money_Moves_Blocks extends AbstractPaymentMethodType
{
    protected $name = 'money_moves';

    public function initialize()
    {
        $this->settings = get_option('woocommerce_money_moves_settings', []);
    }

    public function is_active()
    {
        $gateways = WC()->payment_gateways() ? WC()->payment_gateways()->payment_gateways() : [];
        return isset($gateways['money_moves']) && $gateways['money_moves']->is_available();
    }

    public function get_payment_method_script_handles()
    {
        wp_register_script(
            'money-moves-blocks',
            plugins_url('assets/blocks.js', MONEY_MOVES_WC_FILE),
            ['wc-blocks-registry', 'wp-element', 'wp-html-entities'],
            MONEY_MOVES_WC_VERSION,
            true
        );
        return ['money-moves-blocks'];
    }

    public function get_payment_method_data()
    {
        return [
            'title' => $this->settings['title'] ?? __('Bank transfer, Money Moves or crypto', 'money-moves-payments'),
            'description' => $this->settings['description'] ?? '',
            'icon' => plugins_url('assets/money-moves.png', MONEY_MOVES_WC_FILE),
        ];
    }
}
