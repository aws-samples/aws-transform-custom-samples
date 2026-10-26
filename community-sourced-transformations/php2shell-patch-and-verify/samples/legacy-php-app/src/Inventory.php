<?php
namespace App;

/**
 * Legacy inventory. Contains constructs that are valid in PHP 7.4 and
 * fatal (or silently different) in PHP 8.x.
 */
class Inventory
{
    private $items = [];

    public function add($sku, $qty)
    {
        $this->items[$sku] = (isset($this->items[$sku]) ? $this->items[$sku] : 0) + $qty;
    }

    // each() was removed in PHP 8.0 -> fatal "Call to undefined function each()".
    public function firstSku()
    {
        reset($this->items);
        $pair = each($this->items);
        return $pair ? $pair['key'] : null;
    }

    // count(null) throws TypeError in PHP 8.0 (it was a warning in 7.x).
    public function lineCount($lines)
    {
        return count($lines);
    }

    public function total()
    {
        return array_sum($this->items);
    }
}
