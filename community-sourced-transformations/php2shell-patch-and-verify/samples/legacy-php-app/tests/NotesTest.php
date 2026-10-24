<?php
use App\Notes;
use PHPUnit\Framework\TestCase;

class NotesTest extends TestCase
{
    public function testTitle()
    {
        $this->assertSame('HELLO', (new Notes())->title(' hello '));
        $this->assertSame('UNTITLED', (new Notes())->title());
    }

    public function testGreet()
    {
        $this->assertSame('Hello Ana', (new Notes())->greet('Ana'));
    }
}
