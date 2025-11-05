// コマンド一覧定義
// このファイルで全てのスラッシュコマンドを管理

export const commands = [
  // 参加受付関連
  {
    name: 'start_signup',
    description: '参加受付を開始（例: `/start_signup`）'
  },
  {
    name: 'show_participants',
    description: '現在の参加者を表示（例: `/show_participants`）'
  },
  {
    name: 'reset_participants',
    description: '参加者リセット（例: `/reset_participants`）'
  },
  {
    name: 'leave',
    description: '自分を参加リストから外す（例: `/leave`）'
  },
  {
    name: 'kick_from_lol',
    description: '他人を参加リストから外す（誰でも可）（例: `/kick_from_lol @user`）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true }
    ],
  },

  // ユーザー管理関連
  {
    name: 'set_strength',
    description: 'メンバーの強さを登録/再定義（例: `/set_strength @user 350`）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true },
      { name: 'points', description: 'ポイント値', type: 4, required: true },
    ],
  },
  {
    name: 'join_name',
    description: 'ユーザー名だけで参加者に追加（例: `/join_name name:たろう points:320`）',
    options: [
      { name: 'name', description: '表示名', type: 3, required: true },
      { name: 'points', description: '初期ポイント（省略時300）', type: 4, required: false },
    ],
  },
  {
    name: 'record',
    description: '指定ユーザーの戦績（wins/losses）を上書きします（管理者用）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true },
      { name: 'wins', description: '勝利数', type: 4, required: true },
      { name: 'losses', description: '敗北数', type: 4, required: true },
    ],
  },
  {
    name: 'delete_user',
    description: '指定ユーザーの戦績を完全削除（管理者用）',
    options: [
      { name: 'user', description: '対象ユーザー', type: 6, required: true }
    ],
  },

  // チーム分け関連
  {
    name: 'team',
    description: '強さを考慮してチーム分け（直前と似た構成を回避）（例: `/team`）'
  },
  {
    name: 'team_simple',
    description: '強さ無視でランダム2分割（例: `/team_simple`）'
  },

  // レーン指定チーム分け関連
  {
    name: 'start_lane_signup',
    description: 'ポジション指定で参加受付（例: `/start_lane_signup`）'
  },
  {
    name: 'result_team',
    description: 'レーン指定チームの勝敗を登録（例: `/result_team winteam:1 loseteam:2`）',
    options: [
      {
        name: 'winteam',
        description: '勝利チームID',
        type: 4,
        required: true
      },
      {
        name: 'loseteam',
        description: '敗北チームID',
        type: 4,
        required: true
      }
    ]
  },
  {
    name: 'show_lane_history',
    description: '過去のレーン指定チーム分け結果を表示（当時→現在）（例: `/show_lane_history count:5`）',
    options: [
      {
        name: 'count',
        description: '表示する履歴件数（デフォルト：5件）',
        type: 4,
        required: false
      }
    ]
  },

  // 勝敗登録関連
  {
    name: 'result',
    description: '勝敗を登録（例: `/result winner:A`、`/result winner:B`）',
    options: [
      {
        name: 'winner',
        description: '勝利チーム (A or B)',
        type: 3,
        required: true,
        choices: [
          { name: 'A', value: 'A' },
          { name: 'B', value: 'B' }
        ],
      },
      {
        name: 'match_id',
        description: '対象マッチID（未指定なら最新）',
        type: 4,
        required: false
      },
    ],
  },
  {
    name: 'win',
    description: '簡易勝敗登録（例: `/win A`、`/win B`、`/win A match_id:42`）',
    options: [
      {
        name: 'team',
        description: '勝利チーム (A or B)',
        type: 3,
        required: true,
        choices: [
          { name: 'A', value: 'A' },
          { name: 'B', value: 'B' }
        ],
      },
      {
        name: 'match_id',
        description: '対象マッチID（未指定なら最新）',
        type: 4,
        required: false
      },
    ],
  },

  // 設定関連
  {
    name: 'set_points',
    description: '勝敗ポイント/連勝上限/連敗上限を設定（例: `/set_points win:5 loss:-3 streak_cap:2 loss_streak_cap:2`）',
    options: [
      { name: 'win', description: '勝利ポイント（例: 3）', type: 4, required: false },
      { name: 'loss', description: '敗北ポイント（例: -2）', type: 4, required: false },
      { name: 'streak_cap', description: '連勝ボーナス上限（例: 3）', type: 4, required: false },
      { name: 'loss_streak_cap', description: '連敗ペナルティ上限（例: 3）', type: 4, required: false },
    ],
  },
  {
    name: 'show_points',
    description: '現在のポイント設定を表示（例: `/show_points`）'
  },

  // 情報表示関連
  {
    name: 'rank',
    description: 'ランキング表示（例: `/rank`）'
  },
  {
    name: 'stats',
    description: 'サーバー統計情報を表示（例: `/stats`）'
  },
  {
    name: 'help',
    description: 'コマンド一覧を表示'
  }
];

// コマンドをカテゴリ別に分類
export const commandCategories = {
  '参加受付': [
    'start_signup',
    'show_participants',
    'reset_participants',
    'leave',
    'kick_from_lol'
  ],
  'ユーザー管理': [
    'set_strength',
    'join_name',
    'record',
    'delete_user'
  ],
  'チーム分け': [
    'team',
    'team_simple'
  ],
  'レーン指定': [
    'start_lane_signup',
    'result_team',
    'show_lane_history'
  ],
  '勝敗登録': [
    'result',
    'win'
  ],
  '設定': [
    'set_points',
    'show_points'
  ],
  '情報表示': [
    'rank',
    'stats',
    'help'
  ]
};

// 各コマンドの詳細情報を取得
export function getCommandInfo(commandName) {
  return commands.find(cmd => cmd.name === commandName);
}

// カテゴリ別コマンド一覧を取得
export function getCommandsByCategory(category) {
  const commandNames = commandCategories[category] || [];
  return commandNames.map(name => getCommandInfo(name)).filter(Boolean);
}

// 全カテゴリ一覧を取得
export function getAllCategories() {
  return Object.keys(commandCategories);
}
