<?php
use App\Initials;
use PHPUnit\Framework\TestCase;

class InitialsTest extends TestCase
{
    public function testFirstLetter()
    {
        $this->assertSame('z', (new Initials())->first('zebra'));
    }
}
