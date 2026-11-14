@ 手で書いた見本（2 ポインタの 0F）。
.macro msgbox pointer:req type:req, pointer_kanji
	loadpointer 0x0, \pointer, \pointer_kanji
	callstd \type
.endm

@ Loads a pointer into a script bank.
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
