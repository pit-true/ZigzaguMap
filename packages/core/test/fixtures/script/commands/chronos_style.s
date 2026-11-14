@ Chronos 形式の xse_commands.s の見本（テスト用に手で書いたもの）

.macro callstd function:req
.byte 0x09
.byte \function
.endm

@ Sets the specified script bank to immediate value.
.macro loadpointer destination:req, value:req
.byte 0x0f
.byte \destination
.4byte \value
.endm

.macro loadword destination:req, value:req
	loadpointer \destination, \value
.endm

.macro setvar destination:req, value:req
.byte 0x16
.2byte \destination
.2byte \value
.endm

@ Chronos: speech balloon message. Wire: 2C [localId] [text, 4 bytes LE].
.macro npcmsgbox localId:req text:req
.byte 0x2c
.byte \localId
.4byte \text
.endm

@ Displays the loaded message, then a custom two-choice menu.
@ One text pointer per option, like the standard 0x0F.
.macro customchoice top:req, bottom:req
.byte 0x74
.4byte \top
.4byte \bottom
.endm

.macro givedecoration decor:req
setvar 0x8004 \decor
call EventScript_SecretBase_GiveDecor
.endm

.macro call destination:req
.byte 0x04
.4byte \destination
.endm

.macro msgbox pointer:req type:req
	loadpointer 0x0 \pointer
	callstd \type
.endm
