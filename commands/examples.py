from django.conf import settings
from evennia.utils import utils

COMMAND_DEFAULT_CLASS = utils.class_from_module(settings.COMMAND_DEFAULT_CLASS)
import colorsys

TEMPLATE = """
{instructions}
        
 ┌─────────┐
3│         │
2│         │
1│         │
0│         │
 └─────────┘
  012345678

{label}
"""

class CmdTestAudio(COMMAND_DEFAULT_CLASS):
    """
    play an audio sample on the webclient
    """
    key = 'testaudio'
    help_category = 'Examples'

    def func(self):
        caller = self.caller
        caller.msg(audio='/static/webclient/audio/test.m4a')
        caller.msg(text=('Playing audio, enter `pauseaudio` to stop...', {'type': 'audio'}))


class CmdPauseAudio(COMMAND_DEFAULT_CLASS):
    """
    pause audio playing on the webclient
    """
    key = 'pauseaudio'
    help_category = 'Examples'

    def func(self):
        caller = self.caller
        caller.msg(audio_pause='')
        caller.msg(text=('Pausing audio ...', {'type': 'audio'}))

class CmdClearscreen(COMMAND_DEFAULT_CLASS):
    """
    clears the screen
    """
    key = 'cls'
    help_category = 'Examples'

    def func(self):
        caller = self.caller
        caller.msg(text=('\x1b[2J', {'type': 'clearscreen'}))

    
class CmdMapOn(COMMAND_DEFAULT_CLASS):
    """
    enables the map in webclient
    for now the map takes up right half of terminal and isn't adjustable
    when map is enabled, the webclient reports a new terminal width to Evennia (current width/2)
    """
    key = 'mapon'
    help_category = 'Examples'

    def func(self):
        caller = self.caller
        caller.db.map_enabled = True
        caller.msg(map_enable='')
        caller.msg(text=('Map pane enabled on webclient.', {'type': 'map_enable'}))
        

class CmdMapOff(COMMAND_DEFAULT_CLASS):
    """
    disables the map in webclient
    """
    key = 'mapoff'
    help_category = 'Examples'

    def func(self):
        caller = self.caller
        caller.db.map_enabled = False
        caller.msg(map_disable='')
        caller.msg(text=('Map pane disabled on webclient.', {'type': 'map_disable'}))


class CmdMapTest(COMMAND_DEFAULT_CLASS):
    """ generate test patterns for map pane and text pane.
        whenever the map changes send a 'map' command to the webclient with the new map.
        the map will be redrawn in the webclient when it's updated.
        how maps currently work:
            maps are centered horizontally and vertically within the right terminal
            webclient will crop maps that are too large to display
            this requires webclient to know player relative position so it knows which map
            section to draw, see examples below
    """
    key = 'maptest'
    help_category = 'Examples'
    
    @staticmethod
    def colorize(hue: float, bright: float, input: str, ansi=False):
        """ wrap input string with ANSI color or Evennia color tag from HSV hue
        Args:
            hue (float): HSV hue where green = 120.0
            bright (float): 1.0 = 100% brightness
            input (str): string to colorize
            ansi (bool): if True return raw 24-bit ANSI string, otherwise return ANSIString"""
        if hue != 0.0:
            hue /= 360.0
        sat = 1.0
        r, g, b = tuple(round(i * 255) for i in colorsys.hsv_to_rgb(hue, sat, bright))
        if not ansi:
            return f"|#{r:02x}{g:02x}{b:02x}{input}"  # Evennia-style 24-bit color tag
        return f"\x1b[38;2;{r};{g};{b}m{input}"  # raw ANSI color
    
    @staticmethod
    def make_line(width: int, hue=0.0) -> str:
        line = ''
        a = 65
        for _ in range(width):
            char = CmdMapTest.colorize(hue, 1.0, chr(a))
            line = f"{line}|n{char}|n"
            a += 1
            if a == 91:
                a = 65
            hue += 1.0
            if hue > 360.0:
                    hue = 0.0
        return line
    
    @staticmethod
    def make_pattern(width: int, height: int, intro=True, hue=0.0, ansi=False) -> str:
        """ make a colorful little test pattern for map testing.
            color is used for testing 2 things:
            to make sure webclient centers ANSI colored maps properly,
            and to make sure text pane properly line wraps ANSI strings"""
        num = 0
        pattern = ''
        line = ''
        a = 64
        bright = 1.0
        if intro:
            height -= 1
        for _ in range(height):
            line = ''
            num = -1
            for _ in range(width - 1):
                num += 1
                if num == 10:
                    num = 0
                if bright < 0.2:
                    bright = 1.0
                    hue += 1.0
                if hue > 360.0:
                    hue = 0.0
                line = f"{line}{CmdMapTest.colorize(hue, bright, str(num), ansi)}"
                bright -= 0.05
            a += 1
            if a == 91:
                a = 65
            line = f"|n|u{chr(a)}|n{line}\r\n"
            pattern = f"{pattern}{line}"
        if intro:
            return f"({width}X{height + 1}) Lines end: {str(num)} last line start: |u{chr(a)}|n\r\n{pattern}"
        return pattern
    
    def send_patterns(self, width:int, height: int):
        caller = self.caller
        map_pattern = CmdMapTest.make_pattern(width, height, True, 0.0, False)
        # set map to test pattern above
        # webclient will crop the map if it's too big, but to know where to
        # crop it, it needs to know player position. however, if you're sure
        # that map doesn't need to be cropped, you can always send (0,0) as 'pos'
        caller.msg(map={'map':map_pattern, 'pos':(0,0), 'legend':''})
        sessions = caller.sessions.get()
        flags = sessions[0].protocol_flags
        width = flags.get('SCREENWIDTH')[0]
        text_pattern = CmdMapTest.make_line(width*4, 240.0)
        caller.msg(f"Sending color line of width: ({width}x4)...\n{text_pattern}")

        
    def func(self):
        caller = self.caller
        caller.ndb.map_width = 0
        caller.ndb.map_height = 0
        caller.msg('Enabling map on character and sending test patterns, waiting for client response...')
        caller.msg(map_enable='')  # enable map
        caller.msg(get_map_size='') # get map size
        for _ in range(100): # wait to get map size back from client
            if caller.ndb.map_width == 0:
                yield 0.05
            else:
                break
        self.send_patterns(caller.ndb.map_width, caller.ndb.map_height)
