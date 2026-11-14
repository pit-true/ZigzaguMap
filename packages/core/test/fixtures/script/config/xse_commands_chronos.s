@ 手で書いた見本（1 ポインタの 0F）。
@ .macro loadpointer a, b, c はコメントなので数えない
.macro loadpointer destination:req, value:req
.byte 0x0f
.byte \destination
.4byte \value
.endm

.macro loadword destination:req, value:req
	loadpointer \destination, \value
.endm
