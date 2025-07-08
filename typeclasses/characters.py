"""
Characters

Characters are (by default) Objects setup to be puppeted by Accounts.
They are what you "see" in game. The Character class in this module
is setup to be the "default" character type created by the default
creation commands.

"""

from evennia.objects.objects import DefaultCharacter, DefaultObject
from typing import Callable
from .objects import ObjectParent
from commands.examples import TEMPLATE


class Character(ObjectParent, DefaultCharacter, DefaultObject):
    def at_init(self):
        self._callbacks = {}
        return super().at_init()

    def at_map_size(self, width: int, height: int):
        """
        when map is enabled, or webclient resized, maximum map size is sent here
        """
        self.ndb.map_width = width
        self.ndb.map_height = height

    def at_term_size(self, width: int, height: int):
        """
        this is fired on webclient resize with the new size of the text pane
        """
        pass

    def at_post_puppet(self, **kwargs):
        """
        send command completion list to webclient at login and set a default prompt
        """
        cmds = [cmd.key for cmd in self.cmdset.current.commands] + [cmd.key for cmd in self.db_account.cmdset.current.commands]
        for c in cmds:
            if c.startswith("@"):
                cmds.append(c[1:])
        self.msg(player_commands=cmds)
        self.msg(prompt=">")
        self.msg(map_enable="")
        # map legend is displayed under the map and centered separately
        self.msg(map={"map": TEMPLATE.format(label="Example!", instructions="Instructions?"), "pos": (0, 0), "legend": ""})
        super().at_post_puppet(**kwargs)
