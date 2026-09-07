/** Windows-oriented defaults; system-reserved chords may be intercepted by the browser. */
export const SHORTCUTS=Object.freeze({
 'Space':{tool:'select'},'Shift+Space':{tool:'lasso'},'L':{tool:'line'},'R':{tool:'rectangle'},'C':{tool:'circle'},'A':{tool:'arc'},
 'P':{tool:'pushpull'},'M':{tool:'move'},'Q':{tool:'rotate'},'S':{tool:'scale'},'F':{tool:'offset'},'T':{tool:'measure'},'B':{tool:'paint'},'E':{tool:'eraser'},
 'O':{tool:'orbit'},'H':{tool:'pan'},'Z':{tool:'zoom'},'Shift+Z':{action:'fit'},'G':{action:'component'},'K':{action:'back-edges'},'I':{action:'photo-navigation'},'Shift+S':{action:'command'},
 'Ctrl+N':{action:'new'},'Ctrl+O':{action:'open'},'Ctrl+S':{action:'save'},'Ctrl+Shift+S':{action:'save'},'Ctrl+Z':{action:'undo'},'Ctrl+Shift+Z':{action:'redo'},'Ctrl+Y':{action:'redo'},
 'Ctrl+A':{action:'select-all'},'Ctrl+T':{action:'deselect'},'Ctrl+X':{action:'cut'},'Ctrl+C':{action:'copy'},'Ctrl+V':{action:'paste'},'Ctrl+Shift+V':{action:'paste-in-place'},
 'Ctrl+G':{action:'group'},'Ctrl+Shift+G':{action:'ungroup'},'Ctrl+K':{action:'command'},'Ctrl+I':{action:'import'},'Ctrl+D':{action:'duplicate'},'F1':{action:'help'}
});
export function shortcutFor(e){const key=e.key===' '?'Space':e.key.length===1?e.key.toUpperCase():e.key;return SHORTCUTS[(e.ctrlKey||e.metaKey?'Ctrl+':'')+(e.shiftKey?'Shift+':'')+(e.altKey?'Alt+':'')+key]||null;}
