<?php
namespace App;

class Sorter
{
    // create_function() was removed in PHP 8.0.
    public function byName(array $names)
    {
        $cmp = create_function('$a, $b', 'return strcmp($a, $b);');
        usort($names, $cmp);
        return $names;
    }
}
