import type { Question } from '../shared/types.ts';

/**
 * 診断定義。質問文、左右端の語、5回答位置の補助文、配点を一つのデータとして管理する。
 *
 * 仮データ: 仕様書16章「7問の本文、左右端の語、各位置の補助文、配点」の決定前の値。
 * テーマは仕様書6.1節の基本案（季節、時間帯、場所、光、音、手触り、過ごし方）に従う。
 */
export const QUESTIONS: readonly Question[] = [
  {
    id: 'season',
    theme: '季節',
    prompt: '今すごしたい季節の空気は？',
    leftLabel: 'すずしい',
    rightLabel: 'あたたかい',
    stops: [
      { id: 'far-left', caption: 'すずしい空気', scores: { cyan: 2 } },
      { id: 'left', caption: 'ややすずしい空気', scores: { blue: 1, green: 1 } },
      { id: 'center', caption: 'どちらでもない空気', scores: { green: 1, yellow: 1 } },
      { id: 'right', caption: 'ややあたたかい空気', scores: { orange: 1, yellow: 1 } },
      { id: 'far-right', caption: 'あたたかい空気', scores: { red: 2 } },
    ],
  },
  {
    id: 'time',
    theme: '時間帯',
    prompt: '今いたい時間帯は？',
    leftLabel: '朝',
    rightLabel: '夜',
    stops: [
      { id: 'far-left', caption: '朝がいい', scores: { yellow: 2 } },
      { id: 'left', caption: 'どちらかといえば朝', scores: { cyan: 2 } },
      { id: 'center', caption: '昼から夕方', scores: { orange: 1, green: 1 } },
      { id: 'right', caption: 'どちらかといえば夜', scores: { violet: 1, orange: 1 } },
      { id: 'far-right', caption: '夜がいい', scores: { blue: 2 } },
    ],
  },
  {
    id: 'place',
    theme: '場所',
    prompt: '今いたい場所は？',
    leftLabel: 'ひらけた場所',
    rightLabel: 'こもれる場所',
    stops: [
      { id: 'far-left', caption: 'ひらけた場所', scores: { green: 1, yellow: 1 } },
      { id: 'left', caption: 'ややひらけた場所', scores: { green: 2 } },
      { id: 'center', caption: 'どちらでもない場所', scores: { magenta: 1, orange: 1 } },
      { id: 'right', caption: 'ややこもれる場所', scores: { violet: 2 } },
      { id: 'far-right', caption: 'こもれる場所', scores: { blue: 1, violet: 1 } },
    ],
  },
  {
    id: 'light',
    theme: '光',
    prompt: '今浴びたい光は？',
    leftLabel: 'やわらかい光',
    rightLabel: 'くっきりした光',
    stops: [
      { id: 'far-left', caption: 'やわらかい光', scores: { orange: 2 } },
      { id: 'left', caption: 'ややわらかい光', scores: { magenta: 2 } },
      { id: 'center', caption: 'どちらでもない光', scores: { yellow: 1, violet: 1 } },
      { id: 'right', caption: 'ややくっきりした光', scores: { cyan: 2 } },
      { id: 'far-right', caption: 'くっきりした光', scores: { red: 1, blue: 1 } },
    ],
  },
  {
    id: 'sound',
    theme: '音',
    prompt: '今聞いていたい音は？',
    leftLabel: '静か',
    rightLabel: 'にぎやか',
    stops: [
      { id: 'far-left', caption: '静かな音', scores: { blue: 2 } },
      { id: 'left', caption: 'やや静かな音', scores: { green: 1, violet: 1 } },
      { id: 'center', caption: 'どちらでもない音', scores: { cyan: 1, orange: 1 } },
      { id: 'right', caption: 'ややにぎやかな音', scores: { yellow: 1, magenta: 1 } },
      { id: 'far-right', caption: 'にぎやかな音', scores: { magenta: 2 } },
    ],
  },
  {
    id: 'texture',
    theme: '手触り',
    prompt: '今さわりたい手触りは？',
    leftLabel: 'なめらか',
    rightLabel: 'ざらざら',
    stops: [
      { id: 'far-left', caption: 'なめらかな手触り', scores: { cyan: 1, violet: 1 } },
      { id: 'left', caption: 'ややなめらかな手触り', scores: { blue: 1, magenta: 1 } },
      { id: 'center', caption: 'どちらでもない手触り', scores: { green: 1, red: 1 } },
      { id: 'right', caption: 'ややざらざらした手触り', scores: { orange: 1, red: 1 } },
      { id: 'far-right', caption: 'ざらざらした手触り', scores: { red: 2 } },
    ],
  },
  {
    id: 'pastime',
    theme: '過ごし方',
    prompt: '今の時間をどう過ごしたい？',
    leftLabel: 'ひとりで',
    rightLabel: 'みんなで',
    stops: [
      { id: 'far-left', caption: 'ひとりで過ごしたい', scores: { violet: 2 } },
      { id: 'left', caption: 'どちらかといえばひとりで', scores: { blue: 1, green: 1 } },
      { id: 'center', caption: 'どちらでもいい', scores: { cyan: 1, yellow: 1 } },
      { id: 'right', caption: 'どちらかといえばみんなで', scores: { orange: 1, magenta: 1 } },
      { id: 'far-right', caption: 'みんなで過ごしたい', scores: { yellow: 1, red: 1 } },
    ],
  },
];
