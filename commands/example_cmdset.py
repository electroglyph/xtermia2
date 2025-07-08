from .examples import CmdClearscreen, CmdPauseAudio, CmdTestAudio, CmdMapOff, CmdMapOn, CmdMapTest
import evennia


class ExampleCmdSet(evennia.CmdSet):
    def at_cmdset_creation(self):
        self.add(CmdPauseAudio)
        self.add(CmdTestAudio)
        self.add(CmdClearscreen)
        self.add(CmdMapOff)
        self.add(CmdMapOn)
        self.add(CmdMapTest)
