<?php
use App\Sorter;
use PHPUnit\Framework\TestCase;

class SorterTest extends TestCase
{
    public function testSortsByName()
    {
        $this->assertSame(['a', 'b', 'c'], (new Sorter())->byName(['c', 'a', 'b']));
    }
}
