.text
.thumb
.align 2
/*
sample.s（テスト用の手書きの例）
	NotALabel: この行はコメントの中
*/
.include "../xse_commands.s"
.include "../xse_defines.s"

.equ SAMPLE_FLAG, 0x200 @ サンプルのフラグ
.equ SAMPLE_VAR, VAR_BASE + 1

.global EventScript_Sample
EventScript_Sample:
	lock
	faceplayer
	msgbox gText_Sample MSG_NORMAL @ 話しかけたとき
	compare LASTRESULT 0x1
	if equal _goto EventScript_Sample_Yes
	applymovement PLAYER m_SampleWalk
	waitmovement 0x0
	release
	end

EventScript_Sample_Yes: /* 「はい」のとき */
	setflag SAMPLE_FLAG
	end

m_SampleWalk: .byte walk_up, walk_up, end_m
m_SampleLook: .byte look_down, end_m
