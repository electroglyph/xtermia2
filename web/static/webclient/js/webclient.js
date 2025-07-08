window.addEventListener('load', () => {
    const revision = 1;
    const font = new FontFaceObserver('Fira Custom');
    font.load().then(() => {
        console.log('Font loaded.');
        // try to get options from localstorage, otherwise set the defaults
        let fsize = localStorage.getItem('fontsize');
        if (fsize === null) {
            fsize = 19;
        } else {
            fsize = parseInt(fsize);
        }
        const cstyle = localStorage.getItem('cursorstyle') || 'block';
        let cblink = localStorage.getItem('cursorblink');
        if (cblink === null) {
            cblink = true;
        } else {
            cblink = cblink === 'true';
        }
        let min_contrast = localStorage.getItem('contrast');
        if (min_contrast === null) {
            min_contrast = 1;
        } else {
            min_contrast = parseFloat(min_contrast);
        }
        let screen_reader = localStorage.getItem('reader');
        if (screen_reader === null) {
            screen_reader = false;
        } else {
            screen_reader = screen_reader === 'true';
        }
        let sback = localStorage.getItem('scrollback');
        if (sback === null) {
            sback = 8192;
        } else {
            sback = parseInt(sback);
        }
        let custom_glyphs = localStorage.getItem('glyphs');
        if (custom_glyphs === null) {
            custom_glyphs = true;
        } else {
            custom_glyphs = custom_glyphs === 'true';
        }
        let autosave_setting = localStorage.getItem('autosave');
        if (autosave_setting === null) {
            autosave_setting = false;
        } else {
            autosave_setting = autosave_setting === 'true';
        }
        const font_family = localStorage.getItem('font') || '"Fira Custom", Menlo, monospace';
        const leftTerminalEl = document.getElementById('left-terminal');
        const rightTerminalEl = document.getElementById('right-terminal');
        const dividerEl = document.getElementById('divider');
        const inputBox = document.getElementById('input-box'); // Now a textarea
        const inputContainer = document.createElement('div');
        const inputBoxGhost = document.createElement('textarea');

        function syncInputStyles() {
            const computedStyle = window.getComputedStyle(inputBox);
            ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'padding', 'borderWidth', 'textTransform', 'textIndent', 'whiteSpace', 'wordSpacing', 'backgroundColor'].forEach(prop => {
                inputBoxGhost.style[prop] = computedStyle[prop];
            });
            inputBoxGhost.style.boxSizing = 'border-box';
            inputBox.style.backgroundColor = 'transparent';
            inputBox.style.position = 'relative';
            inputBox.style.zIndex = 2; // Main input on top
            inputBoxGhost.style.position = 'absolute';
            inputBoxGhost.style.top = '0';
            inputBoxGhost.style.left = '0';
            inputBoxGhost.style.width = '100%';
            inputBoxGhost.style.height = '100%';
            inputBoxGhost.style.zIndex = 1; // Ghost input behind
            inputBoxGhost.style.pointerEvents = 'none';
            inputBoxGhost.style.resize = 'none';
        }

        inputContainer.id = 'input-container';
        inputContainer.style.position = 'relative';
        inputBox.parentNode.insertBefore(inputContainer, inputBox);
        inputContainer.appendChild(inputBox);
        inputBoxGhost.id = 'input-box-ghost';
        inputBoxGhost.setAttribute('readonly', true);
        inputBoxGhost.setAttribute('aria-hidden', 'true');
        inputBoxGhost.style.color = 'grey';
        inputContainer.appendChild(inputBoxGhost);
        syncInputStyles();

        let command_history = [];
        const COMMAND_HISTORY_KEY = 'xtermia2CommandHistory';
        try {
            const savedHistory = localStorage.getItem(COMMAND_HISTORY_KEY);
            if (savedHistory) {
                const parsedHistory = JSON.parse(savedHistory);
                if (Array.isArray(parsedHistory)) { // Basic validation
                    command_history = parsedHistory;
                }
            }
        } catch (e) {
            console.error("Could not load command history:", e);
            command_history = [];
        }
        const MAX_HISTORY_SIZE = 2048;
        let completion_matches = [];
        let completion_index = -1;

        const terminalContainer = document.getElementById('terminal-container');

        const DIVIDER_POSITION_KEY = 'xtermDividerPos';
        let initialTextareaHeight;
        const termLeft = new Terminal({
            convertEol: true,
            cursorInactiveStyle: "none",
            allowProposedApi: true,
            disableStdin: false,
            fontFamily: font_family,
            fontSize: fsize,
            cursorBlink: cblink,
            customGlyphs: custom_glyphs,
            cursorStyle: cstyle,
            rescaleOverlappingGlyphs: false,
            scrollback: sback,
            minimumContrastRatio: min_contrast,
            screenReaderMode: screen_reader, // theme: {background: '#1e1e1e', foreground: '#d4d4d4'}
        });
        const termRight = new Terminal({
            convertEol: true,
            cursorInactiveStyle: "none",
            allowProposedApi: true,
            disableStdin: false,
            fontFamily: font_family,
            fontSize: fsize,
            cursorBlink: false,
            customGlyphs: custom_glyphs,
            cursorStyle: 'bar',
            rescaleOverlappingGlyphs: false,
            scrollback: sback,
            minimumContrastRatio: min_contrast,
            screenReaderMode: screen_reader, // theme: {background: '#1e1e1e', foreground: '#d4d4d4'}
        });

        function throttle(func, limit) {
            let inThrottle;
            return function executedFunction(...args) {
                if (!inThrottle) {
                    func.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            }
        }

        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        const throttledFit = throttle(() => {
            fitTerminals();
        }, 16);

        function redrawEverything() {
            fitTerminals();
            if (ws_ready) {
                ws.send(JSON.stringify(['term_size', [termLeft.cols, termLeft.rows], {}]));
                if (rightTerminalEl.style.display !== 'none' && map_enabled) {
                    ws.send(JSON.stringify(['map_size', [termRight.cols, termRight.rows - 1], {}]));
                }
            }
            setTimeout(() => {
                if (rightTerminalEl.style.display !== 'none' && map_enabled) {
                    resizeMap(pos);
                    writeMap();
                }
            }, 0);
        }

        const debouncedRedrawEverything = debounce(redrawEverything, 100);

        function fitTerminals() {
            try {
                if (leftTerminalEl.offsetParent !== null) {
                    fitAddonLeft.fit();
                }
                if (rightTerminalEl.offsetParent !== null) {
                    fitAddonRight.fit();
                }
            } catch (e) {
                console.error("Error fitting terminals:", e);
            }
        }

        function setInitialTextarea() {
            const oldValue = inputBox.value;
            const oldHeight = inputBox.style.height;
            inputBox.value = "X";
            inputBox.style.height = "auto";
            initialTextareaHeight = inputBox.scrollHeight;
            inputBox.value = oldValue;
            inputBox.style.height = oldHeight;
            inputBox.style.height = initialTextareaHeight + 'px';
        }


        function adjustTextareaHeight() {
            const oldHeight = inputBox.clientHeight;
            inputBox.style.height = 'auto';
            const newScrollHeight = Math.max(inputBox.scrollHeight, initialTextareaHeight);
            inputBox.style.height = newScrollHeight + 'px';
            if (inputBoxGhost) {
                inputBoxGhost.style.height = inputBox.style.height;
            }
            const newHeight = inputBox.clientHeight;
            if (newHeight !== oldHeight) {
                redrawEverything();
            }
        }

        function loadDividerPosition() {
            const savedPercentage = localStorage.getItem(DIVIDER_POSITION_KEY);
            if (savedPercentage) {
                const percent = parseFloat(savedPercentage);
                if (!isNaN(percent) && percent > 5 && percent < 95) {
                    leftTerminalEl.style.width = percent + '%';
                } else {
                    leftTerminalEl.style.width = '50%';
                }
            } else {
                leftTerminalEl.style.width = '50%';
            }
        }

        function saveDividerPos() {
            if (rightTerminalEl.style.display !== 'none') {
                const containerWidth = terminalContainer.offsetWidth;
                const leftWidth = leftTerminalEl.offsetWidth;
                if (containerWidth > 0) {
                    const percentage = (leftWidth / containerWidth) * 100;
                    localStorage.setItem(DIVIDER_POSITION_KEY, percentage.toFixed(2));
                }
            }
        }

        function showRightPane() {
            if (rightTerminalEl.style.display === 'none') {
                rightTerminalEl.style.display = '';
                dividerEl.style.display = '';
                loadDividerPosition();
                redrawEverything();
            }
        }

        function hideRightPane() {
            if (rightTerminalEl.style.display !== 'none') {
                rightTerminalEl.style.display = 'none';
                dividerEl.style.display = 'none';
                leftTerminalEl.style.width = '100%';
                redrawEverything();
            }
        }

        setInitialTextarea();
        loadDividerPosition();

        let isCommandSubmitted = false;
        inputBox.addEventListener('input', () => {
            isCommandSubmitted = false;
            adjustTextareaHeight();
            findCompletions();
        });

        inputBox.addEventListener('scroll', () => {
            if (inputBoxGhost) {
                inputBoxGhost.scrollTop = inputBox.scrollTop;
                inputBoxGhost.scrollLeft = inputBox.scrollLeft;
            }
        });

        let isResizing = false;
        dividerEl.addEventListener('mousedown', function (e) {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.body.style.pointerEvents = 'none';
            leftTerminalEl.style.pointerEvents = 'none';
            rightTerminalEl.style.pointerEvents = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isResizing) return;
            let newLeftWidth = e.clientX - terminalContainer.getBoundingClientRect().left;
            const containerWidth = terminalContainer.offsetWidth;
            const dividerWidth = dividerEl.offsetWidth;
            const minTerminalWidth = 50;

            if (newLeftWidth < minTerminalWidth) newLeftWidth = minTerminalWidth;
            if (newLeftWidth > containerWidth - minTerminalWidth - dividerWidth) {
                newLeftWidth = containerWidth - minTerminalWidth - dividerWidth;
            }
            if (newLeftWidth > 0 && newLeftWidth < (containerWidth - dividerWidth)) {
                leftTerminalEl.style.width = newLeftWidth + 'px';
                throttledFit();
            }
        });

        document.addEventListener('mouseup', function () {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = 'default';
                document.body.style.userSelect = 'auto';
                document.body.style.pointerEvents = 'auto';
                leftTerminalEl.style.pointerEvents = 'auto';
                rightTerminalEl.style.pointerEvents = 'auto';
                saveDividerPos();
                redrawEverything();
            }
        });

        let recording_start = 0;
        let recording_buffer = '';
        let recording = false;
        let recording_header = {
            "version": 2, "width": 80, "height": 24, "timestamp": 0, "duration": 0, "title": "xtermia2 recording"
        };
        wrapWrite('\x1b[1;97mxtermia2\x1b[0m terminal emulator (made with xterm.js)\n');
        wrapWrite('revision \x1b[1;97m' + revision + '\x1b[0m\n');
        wrapWrite('Enter :help for a list of \x1b[1;97mxtermia2\x1b[0m commands')
        let player_commands = [];
        const commands = new Map();
        commands.set(':help', [help, ':help = This lists all available commands']);
        commands.set(':fontsize', [fontsize, ':fontsize [size] = Change font size to [size]. Default = 19']);
        commands.set(':fontfamily', [fontfamily, ':fontfamily [font] = Change font family. Default = "Fira Custom"']);
        commands.set(':contrast', [contrast, ':contrast [ratio] = Change minimum contrast ratio, 21 = black and white. Default = 1']);
        commands.set(':reader', [reader, ':reader = Toggle screenreader mode for NVDA or VoiceOver. Default = off']);
        // commands.set(':cursorstyle', [cursorstyle, ':cursorstyle [block,underline,bar] = Change cursor style. Default = block']);
        // commands.set(':cursorblink', [cursorblink, ':cursorblink = Toggle cursor blink. Default = on']);
        commands.set(':glyphs', [glyphs, ':glyphs = Toggle custom glyphs (fixes some box-drawing glyphs). Default = on']);
        commands.set(':scrollback', [scrollback, ':scrollback [rows] = Rows of terminal history. Default = 8192']);
        commands.set(':record', [record, ':record = Begin asciinema recording (share at http://terminoid.com/).']);
        commands.set(':stop', [stop, ':stop = Stop asciinema recording and save JSON file.']);
        commands.set(':save', [save, ':save = Save terminal history to history.txt']);
        commands.set(':autosave', [autosave, ':autosave = Toggle autosave. If enabled, history will be saved on connection close. Default = off']);
        commands.set(':reset', [reset_command, ':reset = Clear local storage and reset settings to default']);
        for (const [key, value] of commands) {
            player_commands.push(key);
        }

        function help(arg) {
            let update = 'Available commands:\n';
            for (const [key, value] of commands) {
                update += value[1] + '\n';
            }
            wrapWrite(update);
        }

        function reset_command(arg) {
            localStorage.clear();
            termLeft.options.fontSize = 19;
            termLeft.options.cursorStyle = 'block';
            termLeft.options.cursorBlink = true;
            termLeft.options.screenReaderMode = false;
            termLeft.options.minimumContrastRatio = 1;
            termLeft.options.scrollback = 8192;
            termLeft.options.customGlyphs = true;
            autosave_setting = false;
            termLeft.options.fontFamily = '"Fira Code", Menlo, monospace';
            termRight.options.fontSize = 19;
            termRight.options.cursorStyle = 'block';
            termRight.options.cursorBlink = true;
            termRight.options.screenReaderMode = false;
            termRight.options.minimumContrastRatio = 1;
            termRight.options.scrollback = 8192;
            termRight.options.customGlyphs = true;
            termRight.options.fontFamily = '"Fira Code", Menlo, monospace';
            fitTerminals()
        }

        function fontfamily(arg) {
            try {
                termLeft.options.fontFamily = arg;
                termRight.options.fontFamily = arg;
                fitTerminals()
                localStorage.setItem("font", arg);
                syncInputStyles();
                wrapWriteln('Font changed to: ' + arg + '.');
                wrapWriteln('If this looks terrible, enter :reset to go back to default font.');
            } catch (e) {
                console.error(e);
                wrapWriteln(e);
                termLeft.options.fontFamily = '"Fira Code", Menlo, monospace';
                termRight.options.fontFamily = '"Fira Code", Menlo, monospace';
            }
        }

        function glyphs(arg) {
            custom_glyphs = !custom_glyphs;
            termLeft.options.customGlyphs = custom_glyphs;
            termRight.options.customGlyphs = custom_glyphs;
            if (custom_glyphs) {
                wrapWriteln('Custom glyphs are ON.');
                localStorage.setItem("glyphs", "true");
            } else {
                wrapWriteln('Custom glyphs are OFF.');
                localStorage.setItem("glyphs", "false");
            }
        }

        function scrollback(arg) {
            termLeft.options.scrollback = parseInt(arg);
            termRight.options.scrollback = parseInt(arg);
            localStorage.setItem("scrollback", arg);
        }

        function reader(arg) {
            // TODO: let Evennia know screenreader status
            screen_reader = !screen_reader;
            termLeft.options.screenReaderMode = screen_reader;
            termRight.options.screenReaderMode = screen_reader;
            if (screen_reader) {
                wrapWriteln('Screen reader is ON.');
                localStorage.setItem("reader", "true");
            } else {
                wrapWriteln('Screen reader is OFF.');
                localStorage.setItem("reader", "false");
            }
        }

        function contrast(arg) {
            termLeft.options.minimumContrastRatio = parseFloat(arg);
            termRight.options.minimumContrastRatio = parseFloat(arg);
            localStorage.setItem("contrast", arg);
            wrapWriteln('Minimum contrast ratio is: ' + arg + '.');
        }

        function fontsize(arg) {
            termLeft.options.fontSize = parseInt(arg);
            termRight.options.fontSize = parseInt(arg);
            fitTerminals()
            syncInputStyles();
            localStorage.setItem("fontsize", arg);
            wrapWriteln('Font size is: ' + arg + '.');
        }

        function save(arg) {
            let h = '';
            for (let i = 0; i < termLeft.buffer.active.length; i++) {
                h += termLeft.buffer.active.getLine(i).translateToString() + '\n';
            }
            saveBlob('history.txt', h);
            wrapWriteln('Terminal history saved.');
        }

        function autosave(arg) {
            autosave_setting = !autosave_setting;
            if (autosave_setting) {
                localStorage.setItem('autosave', 'true');
                wrapWriteln('Autosave is ON.');
            } else {
                localStorage.setItem('autosave', 'false');
                wrapWriteln('Autosave is OFF.');
            }
        }

        function record(arg) {
            // #TODO: reimplement for both terminals, make custom recording format
            recording_start = Date.now();
            recording_header.width = term.cols;
            recording_header.height = term.rows;
            recording_header.timestamp = Math.round(recording_start / 1000);
            recording = true;
        }

        function addRecord(str) {
            const time = (Date.now() - recording_start) / 1000;
            recording_buffer += JSON.stringify([time, "o", str]) + '\n';
        }

        function wrapWrite(d, f) {
            // wrap all term.write() calls with this to enable recording
            termLeft.write(d, f);
            if (recording) {
                addRecord(d);
            }
        }

        function wrapWriteln(d, f) {
            // wrap all term.writeln() calls with this to enable recording
            termLeft.writeln(d, f);
            if (recording) {
                addRecord(d);
            }
        }

        function stop(arg) {
            if (recording) {
                recording = false;
                recording_header.duration = (Date.now() - recording_start) / 1000;
                saveBlob('recording.cast', JSON.stringify(recording_header) + '\n' + recording_buffer);
            } else {
                wrapWriteln("Recording hasn't begun!");
            }
        }

        function handle_command(command) {
            for (const [key, value] of commands) {
                if (command.startsWith(key)) {
                    if (command.includes(' ')) {
                        value[0](command.substring(command.indexOf(' ') + 1));
                    } else {
                        value[0]();
                    }
                }
            }
        }

        function saveBlob(filename, data) {
            const blob = new Blob([data], {type: 'text/csv'});
            if (window.navigator.msSaveOrOpenBlob) {
                window.navigator.msSaveBlob(blob, filename);
            } else {
                const elem = window.document.createElement('a');
                elem.href = window.URL.createObjectURL(blob);
                elem.download = filename;
                document.body.appendChild(elem);
                elem.click();
                document.body.removeChild(elem);
            }
        }

        let ws_ready = false;
        let ws = new WebSocket(wsurl + '?' + csessid);
// const unicode11Addon = new Unicode11Addon.Unicode11Addon();
// term.loadAddon(unicode11Addon);
// term.unicode.activeVersion = '11';
        const webglAddonLeft = new WebglAddon.WebglAddon();
        webglAddonLeft.onContextLoss(e => {
            webglAddonLeft.dispose();
        });
        const webglAddonRight = new WebglAddon.WebglAddon();
        webglAddonRight.onContextLoss(e => {
            webglAddonRight.dispose();
        });
        termLeft.loadAddon(webglAddonLeft);
        termRight.loadAddon(webglAddonRight);
        const weblinksAddonLeft = new WebLinksAddon.WebLinksAddon();
        const weblinksAddonRight = new WebLinksAddon.WebLinksAddon();
        termLeft.loadAddon(weblinksAddonLeft);
        termRight.loadAddon(weblinksAddonRight);
        const fitAddonLeft = new FitAddon.FitAddon();
        const fitAddonRight = new FitAddon.FitAddon();
        termLeft.loadAddon(fitAddonLeft);
        termRight.loadAddon(fitAddonRight);
        termLeft.open(leftTerminalEl);
        termRight.open(rightTerminalEl);
        let audio = new Audio();
        let map_enabled = false;
        // let map_column = 0;
        // let map_max_width = 0;
        hideRightPane();

        setTimeout(redrawEverything, 0);

        let prompt = '';
        let prompt_len = 0;
        let prompt_is_printed = false;
        // let index = -1;
        // let last_dir = 0; // 0 = none, 1 = down, 2 = up
        // let interactive_mode = false;
        // let cursor_x = 0;  // these are used during interactive mode to keep track of relative cursor position
        // let cursor_y = 0;
        // let self_paste = false; // did we send the paste? or is the right-click menu being used?
        // let self_write = false; // if true, don't do onData events
        let enter_pressed = false;
        let censor_input = true; // until login, don't echo input commands so that password isn't leaked
        let map = [];  // current map, split into lines
        let new_map = []; // map after resize, or the original map if resize not needed
        let pos = [];  // last position sent for map
        let legend = [];  // current map legend, split into lines
        let map_width = 0;
        let map_height = 0;
        let new_map_width = 0;
        let new_map_height = 0;
        const ansi_color_regex = /\x1B\[[0-9;]+m/g
        const grey = '\x1B[38;5;243m';
        const reset = '\x1B[0m';
        const command_color = '\x1B[38;5;220m';
        const highlight = '\x1B[48;5;24m';
        const default_color = '\x1B[38;2;190;190;190m';
        const default_color_reset = '\x1B[0m\x1B[38;2;190;190;190m';
        const white = '\x1B[37m';
        let cursor_pos = 0;
        let command = '';

        function updateCompletionHint() {
            if (completion_index !== -1 && completion_matches[completion_index]) {
                const currentInput = inputBox.value;
                const suggestion = completion_matches[completion_index];
                if (suggestion.startsWith(currentInput) && suggestion.length > currentInput.length) {
                    inputBoxGhost.value = suggestion;
                    inputBoxGhost.scrollTop = inputBox.scrollTop;
                    inputBoxGhost.scrollLeft = inputBox.scrollLeft;
                } else {
                    inputBoxGhost.value = '';
                }
            } else {
                inputBoxGhost.value = '';
            }
        }

        function findCompletions() {
            const text = inputBox.value;
            if (text === '') {
                completion_matches = [];
                completion_index = -1;
                updateCompletionHint();
                return;
            }
            const potentialCompletions = [...new Set([...command_history, ...player_commands])];
            completion_matches = potentialCompletions.filter(cmd => cmd.startsWith(text) && cmd !== text);

            if (completion_matches.length > 0) {
                completion_index = 0;
            } else {
                completion_index = -1;
            }
            updateCompletionHint();
        }

        function acceptCompletion() {
            if (completion_index !== -1 && completion_matches[completion_index]) {
                inputBox.value = completion_matches[completion_index];
                completion_matches = [];
                completion_index = -1;
                updateCompletionHint();
                adjustTextareaHeight();
                inputBox.focus();
                inputBox.setSelectionRange(inputBox.value.length, inputBox.value.length);
            }
        }

        inputBox.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const isFullySelected = inputBox.selectionStart === 0 && inputBox.selectionEnd === inputBox.value.length && inputBox.value.length > 0;

                if (((inputBox.value === '' || isFullySelected) && completion_index === -1) || (completion_index > -1 && command_history.includes(completion_matches[completion_index]))) {
                    if (completion_index === -1) {
                        completion_matches = [...new Set([...command_history, ...player_commands])];
                    }
                }
                if (completion_matches.length > 0) {
                    e.preventDefault();

                    if (completion_index === -1) {
                        completion_index = e.key === 'ArrowUp' ? 0 : completion_matches.length - 1;
                    } else {
                        completion_index = e.key === 'ArrowUp' ? (completion_index - 1 + completion_matches.length) % completion_matches.length : (completion_index + 1) % completion_matches.length;
                    }

                    const suggestion = completion_matches[completion_index];
                    if (inputBox.value === '' || isFullySelected || command_history.includes(suggestion)) {
                        inputBox.value = suggestion;
                        inputBoxGhost.value = '';
                        adjustTextareaHeight();
                        requestAnimationFrame(() => {
                            inputBox.setSelectionRange(inputBox.value.length, inputBox.value.length);
                        });
                    } else {
                        updateCompletionHint();
                    }
                    return;
                }
            }

            const hasCompletion = completion_index !== -1 && completion_matches.length > 0;
            if (hasCompletion) {
                if (e.key === 'Tab' || (e.key === 'ArrowRight' && inputBox.selectionStart === inputBox.value.length)) {
                    e.preventDefault();
                    acceptCompletion();
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    completion_matches = [];
                    completion_index = -1;
                    updateCompletionHint();
                    return;
                }
            }

            if (isCommandSubmitted && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
                isCommandSubmitted = false;
                inputBox.value = '';
                findCompletions();
                return;
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                command = inputBox.value;
                if (command && !censor_input && command_history[0] !== command) {
                    command_history.unshift(command);
                    if (command_history.length > MAX_HISTORY_SIZE) {
                        command_history.pop();
                    }
                }

                completion_matches = [];
                completion_index = -1;
                updateCompletionHint();

                enter_pressed = true;
                if (command) {
                    if (command[0] === ':') {
                        wrapWriteln(command_color + command + reset);
                        handle_command(command);
                        inputBox.value = '';
                        isCommandSubmitted = false;
                    } else {
                        ws.send(JSON.stringify(['text', [command], {}]));
                        if (!censor_input) {
                            wrapWriteln(command_color + command + reset);
                        }
                        inputBox.select();
                        isCommandSubmitted = true;
                    }
                } else {
                    ws.send(JSON.stringify(['text', ['\n'], {}]));
                }
                adjustTextareaHeight();
            }
        });

        function writeMap() {
            termRight.write('\x1b[2J\x1b[3J\x1b[H');
            if (!new_map || new_map.length === 0 || termRight.rows === 0) {
                return;
            }
            const has_legend = legend && legend.length > 0 && legend[0] !== '';
            let legend_height = 0;
            let legend_max_width = 0;

            if (has_legend) {
                legend_height = legend.length;
                for (const line of legend) {
                    const stripped_len = line.replace(ansi_color_regex, '').length;
                    if (stripped_len > legend_max_width) {
                        legend_max_width = stripped_len;
                    }
                }
            }

            const content_height = new_map_height + (has_legend ? 1 + legend_height : 0);
            let start_row = Math.floor((termRight.rows - content_height) / 2) + 1;
            start_row = Math.max(1, start_row);
            let update = '';
            let current_row = start_row;
            let map_horizontal_padding = Math.floor((termRight.cols - new_map_width) / 2) + 1;
            map_horizontal_padding = Math.max(1, map_horizontal_padding);

            for (const line of new_map) {
                update += `\x1b[${current_row};${map_horizontal_padding}H` + line;
                current_row++;
            }

            if (has_legend) {
                current_row++;
                let legend_horizontal_padding = Math.floor((termRight.cols - legend_max_width) / 2) + 1;
                legend_horizontal_padding = Math.max(1, legend_horizontal_padding);

                for (const line of legend) {
                    update += `\x1b[${current_row};${legend_horizontal_padding}H` + line;
                    current_row++;
                }
            }
            termRight.write(reset + update);
        }

        ws.onopen = function () {
            wrapWrite('\n======== Connected.\n');
            ws_ready = true;
            ws.send(JSON.stringify(['term_size', [termLeft.cols, termLeft.rows], {}]));
        };

        ws.onclose = function () {
            wrapWrite('\n======== Connection lost.\n');
            ws_ready = false;
            if (autosave_setting) {
                save();
            }
            localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(command_history));
        };

        function ANSIsubstring(input, start, end) {
            // get substring of ANSI string while ignoring control codes
            let pos = 0;
            let start_pos = 0;
            let end_pos = 0;
            let is_ansi = false;
            let ansi_seen = false;
            for (let i = 0; i < input.length; i++) {
                if (pos === end) {
                    break;
                }
                if (is_ansi) {
                    if (input[i] === 'm' || input[i] === 'K') {
                        is_ansi = false;
                    }
                } else {
                    if (input[i] === '\x1b') {
                        is_ansi = true;
                        ansi_seen = true;
                    } else {
                        if (pos < start) {
                            start_pos = i + 1;
                        }
                        if (pos < end) {
                            end_pos = i + 2;
                        }
                        pos++;
                    }
                }
            }
            if (start_pos <= end_pos) {
                if (ansi_seen) {
                    // append ansi reset in case we chop an ANSI string
                    return input.substring(start_pos, end_pos) + reset;
                } else {
                    return input.substring(start_pos, end_pos);
                }
            }
            return '';
        }

        function resizeMap(pos) {
            if (!map || map.length === 0 || !pos || pos.length < 2) {
                new_map = [];
                new_map_width = 0;
                new_map_height = 0;
                return;
            }
            const has_legend = legend && legend.length > 0 && legend[0] !== '';
            const view_width = termRight.cols;
            const legend_height = has_legend ? legend.length : 0;
            const separator_height = has_legend ? 1 : 0;
            const available_height = termRight.rows - legend_height - separator_height;
            const view_height = Math.max(1, available_height);

            if (map_width <= view_width && map_height <= view_height) {
                new_map = [...map]; // Use spread for a shallow copy
                new_map_width = map_width;
                new_map_height = map_height;
                return;
            }

            const clamped_player_y = Math.max(0, Math.min(pos[1], map_height - 1));
            const map_y = map_height - 1 - clamped_player_y;

            let y_start;
            if (map_height > view_height) {
                const half_height = Math.floor(view_height / 2);
                y_start = map_y - half_height;
                y_start = Math.max(0, y_start);
                y_start = Math.min(y_start, map_height - view_height);
            } else {
                y_start = 0;
            }

            const player_x = Math.max(0, Math.min(pos[0], map_width - 1));

            let x_start;
            if (map_width > view_width) {
                const half_width = Math.floor(view_width / 2);
                x_start = player_x - half_width;
                x_start = Math.max(0, x_start);
                x_start = Math.min(x_start, map_width - view_width);
            } else {
                x_start = 0;
            }

            const y_end = y_start + view_height;
            const vertically_sliced_map = map.slice(y_start, y_end);

            const temp_new_map = [];
            const x_end = x_start + view_width;

            for (const line of vertically_sliced_map) {
                temp_new_map.push(ANSIsubstring(line, x_start, x_end));
            }
            new_map = temp_new_map;
            new_map_height = new_map.length;

            let max_len = 0;
            for (const line of new_map) {
                const stripped_line = line.replace(ansi_color_regex, '');
                if (stripped_line.length > max_len) {
                    max_len = stripped_line.length;
                }
            }
            new_map_width = max_len;
        }

        function onText(input) {
            if (input.charAt(0) !== '\x1B') {
                input = default_color + input;
            }
            input = input.replaceAll(reset, default_color_reset);
            input = input.replaceAll(white, default_color);
            if (prompt_is_printed) { // erase prompt
                wrapWrite('\r' + ' '.repeat(prompt_len) + '\r' + reset + input + reset + prompt);
            } else {
                wrapWrite(reset + input + reset + prompt);
            }
            prompt_is_printed = prompt !== '';
        }

        const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

        async function onMessage(e) {
            let msg = JSON.parse(e.data);
            switch (msg[0]) {
                case 'text':
                    onText(msg[1][0]);
                    break;
                // case 'raw_text':  // default text messages get \n appended to them before being sent, this doesn't
                //     writeSelf(msg[1][0]);
                //     break;
                case 'prompt':
                    const old_prompt_len = prompt_len;
                    prompt = msg[1][0];
                    prompt_len = msg[1][0].replace(ansi_color_regex, '').length;
                    if (prompt_is_printed) { // replace prompt
                        wrapWrite('\r' + ' '.repeat(old_prompt_len) + '\r' + reset + prompt + reset);
                    } else {
                        wrapWrite(reset + prompt + reset);
                    }
                    break;
                case 'audio':
                    audio.pause();
                    audio.src = msg[1][0];
                    audio.play();
                    break;
                case 'audio_pause':
                    audio.pause();
                    break;
                case 'logged_in':
                    censor_input = false;
                    ws.send(JSON.stringify(['term_size', [termLeft.cols, termLeft.rows], {}]));
                    break;
                case 'player_commands':
                    player_commands.push(...msg[1]);
                    break;
                case 'map_enable':
                    map_enabled = true;
                    showRightPane();
                    break;
                case 'map_disable':
                    map_enabled = false;
                    hideRightPane();
                    break;
                case 'get_map_size':
                    ws.send(JSON.stringify(['map_size', [termRight.cols, termRight.rows - 1], {}]));
                    break;
                case 'map':
                    if (map_enabled) {
                        // msg[2].map = msg[2].map.replaceAll(reset, default_color_reset);
                        // msg[2].map = msg[2].map.replaceAll(white, default_color);
                        msg[2].legend = msg[2].legend.replaceAll(reset, default_color_reset);
                        msg[2].legend = msg[2].legend.replaceAll(white, default_color);
                        map = msg[2].map.split(/\r?\n/);
                        new_map = [...map];
                        pos = msg[2].pos;
                        legend = msg[2].legend.split(/\r?\n/);
                        // strip ANSI before checking width
                        const stripped = msg[2].map.replace(ansi_color_regex, '').split(/\r?\n/);
                        // figure out map width so it can be centered
                        map_width = 0;
                        map_height = map.length;
                        new_map_height = map_height;
                        for (let i = 0; i < stripped.length; i++) {
                            if (stripped[i].length > map_width) {
                                map_width = stripped[i].length;
                            }
                        }
                        new_map_width = map_width;
                        resizeMap(pos);
                        writeMap();
                    }
                    break;
                case 'buffer':
                    // this is for writing buffers with flow control
                    // this command expects an array of strings to write sequentially to the terminal
                    let x = 0;

                async function next() {
                    x += 1;
                    if (x >= msg[1].length) {
                        wrapWrite(reset + '\x1B[?25h\n');
                    } else {
                        // slow down buffer playback if necessary
                        //await sleep(0);
                        wrapWrite(msg[1][x], next);
                    }
                }
                    wrapWrite(msg[1][x], next)
                    break;
                default:
                    console.log('Unknown command: ' + msg);
            }
        }

        ws.addEventListener("message", e => onMessage(e));
        ws.onerror = function (e) {
            console.log(e);
            wrapWrite('\n======== Connection error: ' + e + '\n');
        };
        inputBox.focus();
        window.addEventListener('focus', (e) => {
            inputBox.focus();
        });
        // window.addEventListener('keydown', (e) => {
        //     inputBox.focus();
        // });
        window.addEventListener('resize', function (e) {
            // fitTerminals();
            debouncedRedrawEverything();
        }, true);
        window.addEventListener('beforeunload', () => {
            localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(command_history));
        });
    }).catch(() => {
        console.error('Font loading failed!');
    });
});