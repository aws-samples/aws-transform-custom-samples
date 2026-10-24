<?php
namespace App;

class Initials
{
    // Curly-brace string offsets were removed in PHP 8.0 (parse error).
    public function first($text)
    {
        return $text{0};
    }
}
