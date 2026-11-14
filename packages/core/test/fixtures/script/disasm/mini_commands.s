@ 逆アセンブルのテスト用に手で書いた、小さな命令表（ND の書き方に似せた 2 ポインタの 0F）。

.macro end
.byte 0x02
.endm

.macro return
.byte 0x03
.endm

.macro call destination:req
.byte 0x04
.4byte \destination
.endm

.macro goto destination:req
.byte 0x05
.4byte \destination
.endm

@ 同じ番号の別名（先に書いた goto を使う）。
.macro jump destination:req
.byte 0x05
.4byte \destination
.endm

.macro goto_if condition:req destination:req
.byte 0x06
.byte \condition
.4byte \destination
.endm

.macro callstd function:req
.byte 0x09
.byte \function
.endm

@ 漢字を省くと同じポインタを 2 回書く。
.macro loadpointer destination:req, value:req, value_kanji
.byte 0x0F
.byte \destination
.4byte \value
.ifb \value_kanji
.4byte \value
.else
.4byte \value_kanji
.endif
.endm

@ 複数の命令をまとめたもの（逆アセンブルには使わない）。
.macro msgbox pointer:req type:req, pointer_kanji
loadpointer 0x0 \pointer \pointer_kanji
callstd \type
.endm

.macro setvar destination:req value:req
.byte 0x16
.hword \destination
.hword \value
.endm

.macro callasm func:req
.byte 0x23
.4byte \func
.endm

.macro applymovement index:req movements:req mapGroup mapNum
.ifb \mapGroup
.byte 0x4F
.hword \index
.4byte \movements
.else
.byte 0x50
.hword \index
.4byte \movements
.byte \mapGroup
.byte \mapNum
.endif
.endm

.macro trainerbattle1 type:req index:req filler:req intro:req loss:req extra:req
.byte 0x5C
.byte 0x1
.hword \index
.hword \filler
.word \intro
.word \loss
.word \extra
.endm

.macro bufferstring out:req offset:req
.byte 0x85
.byte \out
.4byte \offset
.endm

.macro mart products:req
.byte 0x86
.4byte \products
.endm

.macro warp bank:req map:req warp:req x_axis=0 y_axis=0
.byte 0x39
.byte \bank
.byte \map
.byte \warp
.hword \x_axis
.hword \y_axis
.endm
