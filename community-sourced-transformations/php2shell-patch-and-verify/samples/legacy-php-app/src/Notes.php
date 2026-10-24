<?php
namespace App;

class Notes
{
    // Deprecated in PHP 8.4: implicitly nullable parameter type.
    public function title(string $text = null)
    {
        return strtoupper(trim($text === null ? 'untitled' : $text));
    }

    // Deprecated in PHP 8.2: creation of dynamic properties.
    public function tag($name)
    {
        $this->{$name} = true;
        return $this;
    }

    // Deprecated in PHP 8.2: "${var}" string interpolation.
    public function greet($user)
    {
        return "Hello ${user}";
    }
}
