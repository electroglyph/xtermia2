"""
Input functions

Input functions are always called from the client (they handle server
input, hence the name).

This module is loaded by being included in the
`settings.INPUT_FUNC_MODULES` tuple.

All *global functions* included in this module are considered
input-handler functions and can be called by the client to handle
input.

An input function must have the following call signature:

    cmdname(session, *args, **kwargs)

Where session will be the active session and *args, **kwargs are extra
incoming arguments and keyword properties.

A special command is the "default" command, which is will be called
when no other cmdname matches. It also receives the non-found cmdname
as argument.

    default(session, cmdname, *args, **kwargs)

"""
from evennia.utils import logger

def term_size(session, *args, **kwargs):
    if args:
        session.update_flags(SCREENWIDTH={0: args[0]}, SCREENHEIGHT={0: args[1]})
        puppet = session.get_puppet()
        if puppet:
            puppet.at_term_size(args[0], args[1])
            
            
def map_size(session, *args, **kwargs):
    # this is sent in response to 'get_map_size' command
    # args[0] = max map width, args[1] = max map height
    if args:
        puppet = session.get_puppet()
        if puppet is not None:
            puppet.at_map_size(args[0], args[1])


def default(session, cmdname, *args, **kwargs):
    """
    Handles commands without a matching inputhandler func.

    Args:
        session (Session): The active Session.
        cmdname (str): The (unmatched) command name
        args, kwargs (any): Arguments to function.

    """
    logger.log_err(f"Unknown command received: {cmdname} {str(args)} {str(kwargs)}")
