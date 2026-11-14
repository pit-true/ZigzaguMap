@ ND 形式の xse_commands.s の見本（テスト用に手で書いたもの）

@Message box types
.equ MSG_FIND, 0x1
.equ MSG_NORMAL, 0x6
.equ STD_BASE, 0x8
.equ STD_PUT_ITEM_AWAY, STD_BASE + 0

.macro if condition:req goto_or_call:req script:req
.byte \goto_or_call, \condition
.word \script
.endm

@Commands
@ Terminates script execution.
.macro end
.byte 0x02
.endm

@ Jumps to destination.
.macro goto destination:req
.byte 0x05
.4byte \destination
.endm

.macro jump destination:req
	goto \destination
.endm

@ Calls the standard function at index function.
.macro callstd function:req
.byte 0x09
.byte \function
.endm

@ Sets the specified script bank to immediate value.
@ ND extends command 0x0F to take hiragana/kanji text pointers.
.macro loadpointer destination:req, value:req, value_kanji
.byte 0x0f
.byte \destination
.4byte \value
	.ifb \value_kanji
		.4byte \value
	.else
		.4byte \value_kanji
	.endif
.endm

.macro setvar destination:req, value:req
.byte 0x16
.2byte \destination
.2byte \value
.endm

.macro setflag a:req
.byte 0x29
.2byte \a
.endm

@ Applies the movement data.
.macro applymovement index:req, movements:req, mapGroup, mapNum
	.ifb \mapGroup
		.byte 0x4f
		.2byte \index
		.4byte \movements
	.else
		.byte 0x50
		.2byte \index
		.4byte \movements
		.byte \mapGroup
		.byte \mapNum
	.endif
.endm

.macro customchoice top:req, top_kanji:req, bottom:req, bottom_kanji:req
.byte 0x74
.4byte \top
.4byte \top_kanji
.4byte \bottom
.4byte \bottom_kanji
.endm

.macro updatecoins x=0, y=0
.byte 0xc2
.byte \x
.byte \y
.endm

.macro updatecoinsbox x=0, y=0
	updatecoins \x, \y
.endm

.macro releasecurrentlayer bank:req, map:req
.byte 0xa9
map \map
.endm

.macro setobjectxyperm localId:req
	setobjectxyperm \localId
.endm

@Macro macros, from XSE.
.macro msgbox pointer:req type:req, pointer_kanji
	.ifb \pointer_kanji
		loadpointer 0x0 \pointer
	.else
		loadpointer 0x0 \pointer \pointer_kanji
	.endif
	callstd \type
.endm

.macro finditem item:req
	setvar 0x8000 \item
	callstd MSG_FIND @ 定数を引数に渡す
.endm

.macro putitemaway
	callstd STD_PUT_ITEM_AWAY
.endm

/*.macro braillemessage_wait text:req
	braillemessage \text
.endm*/

.macro levelscript var:req val:req script:req
.hword \var, \val
.word \script
.endm
