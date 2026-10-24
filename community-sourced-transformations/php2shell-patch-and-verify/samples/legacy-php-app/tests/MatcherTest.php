<?php
use App\Matcher;
use PHPUnit\Framework\TestCase;

class MatcherTest extends TestCase
{
    public function testZeroLikeValues()
    {
        $m = new Matcher();
        $this->assertTrue($m->isZeroLike(0));
        $this->assertTrue($m->isZeroLike('abc')); // true on 7.4, false on 8.x
    }
}
