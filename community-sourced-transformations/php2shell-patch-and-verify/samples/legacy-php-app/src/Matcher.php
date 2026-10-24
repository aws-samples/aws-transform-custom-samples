<?php
namespace App;

class Matcher
{
    // Silent semantic change: in PHP 7.4, 0 == "abc" is true. In PHP 8.0 it is false.
    // No crash, no warning: only a test notices.
    public function isZeroLike($value)
    {
        return $value == 0;
    }
}
