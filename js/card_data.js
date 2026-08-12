// card_data.js — HAND BATTLE card database
// 카드의 "정의"만 둔다. 실제 상태 변경/효과 처리는 data_proceeding.js가 담당한다.
//
// 기본 원칙
// - DRAW: 덱 맨 위에서 일반 패(비공개)로 가져온다.
// - SEARCH: 덱/묘지/제외/필드/키 카드 덱 등에서 공개 패로 가져온다.
// - cost와 resolution은 별도 단계다. 같은 이동이라도 엔진은 원인을 COST / EFFECT로 구분한다.
// - "대상으로"는 target, "고르고/선택하고"는 resolution 내부 choice(selector)로 구분한다.
// - 효과 외 텍스트는 nonEffectText에 둔다.
// - 카드 데이터는 게임 중 수정하지 않는다. 실제 카드는 별도 instance로 관리한다.

export const CARD_SCHEMA_VERSION = 1;

export const cards = {
  PG001: {
    id: "PG001",
    name: "펭귄 마을",
    cardType: "normal",
    isKeyCard: false,
    theme: "펭귄",

    nonEffectText: [
      {
        text: "이 카드명의 1효과는 1턴에 1번밖에 발동할 수 없다.",
        type: "EFFECT_LIMIT",
        effectIds: [1],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "자신 전개 단계에 이 카드를 공개하고 발동할 수 있다. 자신은 1장 드로우한다.",
        type: "ACTIVATED",
        optional: true,
        sourceZone: "HAND",
        timing: {
          turn: "SELF",
          phase: "DEPLOY",
        },
        cost: [
          {
            type: "REVEAL",
            target: "SELF_CARD",
          },
        ],
        resolution: [
          {
            type: "DRAW",
            player: "SELF",
            count: 1,
          },
        ],
      },
      {
        id: 2,
        text: "이 카드가 공개 상태에서 버려질 경우, 대신 자신 몬스터 존의 '펭귄'몬스터 1장을 묘지로 보낼 수 있다.",
        type: "REPLACEMENT",
        optional: true,
        event: {
          type: "WOULD_DISCARD",
          target: "SELF_CARD",
          from: "PUBLIC_HAND",
        },
        replacement: {
          cancelOriginal: true,
          actions: [
            {
              type: "SEND_TO_GRAVE",
              choice: {
                controller: "SELF",
                zones: ["FIELD"],
                cardType: "monster",
                theme: "펭귄",
                count: {
                  min: 1,
                  max: 1,
                },
              },
            },
          ],
        },
      },
    ],
  },

  PG002: {
    id: "PG002",
    name: "꼬마 펭귄",
    cardType: "monster",
    isKeyCard: false,
    theme: "펭귄",
    atk: 1,

    nonEffectText: [
      {
        text: "이 카드명의 1,2효과는 각각 1턴에 2번까지 발동할 수 있다.",
        type: "EFFECT_LIMIT",
        effectIds: [1, 2],
        mode: "EACH",
        scope: "TURN",
        count: 2,
      },
    ],

    effects: [
      {
        id: 1,
        text: "자신 전개 단계에 발동할 수 있다. 이 카드를 패에서 소환한다.",
        type: "ACTIVATED",
        optional: true,
        sourceZone: ["HAND", "PUBLIC_HAND"],
        timing: {
          turn: "SELF",
          phase: "DEPLOY",
        },
        resolution: [
          {
            type: "SUMMON",
            target: "SELF_CARD",
            from: ["HAND", "PUBLIC_HAND"],
          },
        ],
      },
      {
        id: 2,
        text: "이 카드를 소환했을 경우에 발동할 수 있다. 덱에서 '펭귄'몬스터 1장을 소환한다.",
        type: "TRIGGER",
        optional: true,
        event: {
          type: "SUMMONED",
          target: "SELF_CARD",
        },
        resolution: [
          {
            type: "SUMMON",
            from: "DECK",
            choice: {
              controller: "SELF",
              cardType: "monster",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
    ],
  },

  PG003: {
    id: "PG003",
    name: "펭귄 부부",
    cardType: "monster",
    isKeyCard: false,
    theme: "펭귄",
    atk: 2,

    nonEffectText: [
      {
        text: "이 카드명의 1효과는 1턴에 1번밖에 발동할 수 없다.",
        type: "EFFECT_LIMIT",
        effectIds: [1],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "이 카드를 덱에서 소환했을 경우에 발동할 수 있다. 덱에서 '펭귄'카드를 2장까지 패에 넣고, 그 후 패를 1장 고르고 버린다.",
        type: "TRIGGER",
        optional: true,
        event: {
          type: "SUMMONED",
          target: "SELF_CARD",
          from: "DECK",
        },
        resolution: [
          {
            type: "SEARCH",
            from: "DECK",
            choice: {
              controller: "SELF",
              theme: "펭귄",
              count: {
                min: 0,
                max: 2,
              },
            },
          },
          {
            type: "DISCARD",
            choice: {
              controller: "SELF",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
      {
        id: 2,
        text: "패의 이 카드를 보여주고 발동할 수 있다. 자신은 2장 드로우한 뒤 패를 1장 고르고 버린다. 그 후 이 카드를 덱으로 되돌린다.",
        type: "ACTIVATED",
        optional: true,
        sourceZone: ["HAND", "PUBLIC_HAND"],
        cost: [
          {
            type: "REVEAL",
            target: "SELF_CARD",
          },
        ],
        resolution: [
          {
            type: "DRAW",
            player: "SELF",
            count: 2,
          },
          {
            type: "DISCARD",
            choice: {
              controller: "SELF",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 1,
                max: 1,
              },
            },
          },
          {
            type: "RETURN_TO_DECK",
            target: "SELF_CARD",
          },
        ],
      },
    ],
  },

  PG004: {
    id: "PG004",
    name: "현자 펭귄",
    cardType: "monster",
    isKeyCard: false,
    theme: "펭귄",
    atk: 2,

    nonEffectText: [
      {
        text: "이 카드명의 1,2효과는 각각 1턴에 1번밖에 발동할 수 없다.",
        type: "EFFECT_LIMIT",
        effectIds: [1, 2],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "'펭귄 마을'이 공개 상태로 존재할 경우에 발동할 수 있다. 자신은 1장 드로우한다. 그 후 패를 1장 고르고 버린다.",
        type: "ACTIVATED",
        optional: true,
        condition: {
          type: "EXISTS",
          selector: {
            controller: "SELF",
            zones: ["PUBLIC_HAND"],
            cardId: "PG001",
          },
        },
        resolution: [
          {
            type: "DRAW",
            player: "SELF",
            count: 1,
          },
          {
            type: "DISCARD",
            choice: {
              controller: "SELF",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
      {
        id: 2,
        text: "자신 전개 단계에 발동할 수 있다. 덱에서 '펭귄'카드 1장을 패에 넣는다.",
        type: "ACTIVATED",
        optional: true,
        timing: {
          turn: "SELF",
          phase: "DEPLOY",
        },
        resolution: [
          {
            type: "SEARCH",
            from: "DECK",
            choice: {
              controller: "SELF",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
    ],
  },

  PG005: {
    id: "PG005",
    name: "수문장 펭귄",
    cardType: "monster",
    isKeyCard: false,
    theme: "펭귄",
    atk: 3,

    nonEffectText: [
      {
        text: "이 카드명의 1,2효과는 각각 1턴에 1번밖에 발동할 수 없다.",
        type: "EFFECT_LIMIT",
        effectIds: [1, 2],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "'펭귄 마을'이 공개 상태로 존재할 경우에 발동할 수 있다. 이 카드의 공격력을 1 올린다. 그 후 서로 패를 1장 고르고 버린다.",
        type: "ACTIVATED",
        optional: true,
        condition: {
          type: "EXISTS",
          selector: {
            controller: "SELF",
            zones: ["PUBLIC_HAND"],
            cardId: "PG001",
          },
        },
        resolution: [
          {
            type: "CHANGE_ATK",
            target: "SELF_CARD",
            operation: "ADD",
            value: 1,
          },
          {
            type: "DISCARD",
            choice: {
              controller: "SELF",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 1,
                max: 1,
              },
            },
          },
          {
            type: "DISCARD",
            choice: {
              controller: "OPPONENT",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
      {
        id: 2,
        text: "자신 '펭귄'몬스터가 '펭귄 마을'의 효과로 묘지로 보내졌을 경우 발동할 수 있다. 상대 필드의 몬스터 1장을 고르고 묘지로 보낸다.",
        type: "TRIGGER",
        optional: true,
        event: {
          type: "SENT_TO_GRAVE",
          card: {
            controller: "SELF",
            cardType: "monster",
            theme: "펭귄",
          },
          cause: {
            cardId: "PG001",
            kind: "EFFECT",
          },
        },
        resolution: [
          {
            type: "SEND_TO_GRAVE",
            choice: {
              controller: "OPPONENT",
              zones: ["FIELD"],
              cardType: "monster",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
    ],
  },

  PG006: {
    id: "PG006",
    name: "펭귄!돌격!",
    cardType: "normal",
    isKeyCard: false,
    theme: "펭귄",

    nonEffectText: [],

    effects: [
      {
        id: 1,
        text: "자신 전개 단계에 발동할 수 있다. 덱에서 '펭귄'몬스터 1장을 소환한다.",
        type: "ACTIVATED",
        optional: true,
        timing: {
          turn: "SELF",
          phase: "DEPLOY",
        },
        resolution: [
          {
            type: "SUMMON",
            from: "DECK",
            choice: {
              controller: "SELF",
              cardType: "monster",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
      {
        id: 2,
        text: "묘지의 이 카드를 제외하고 발동할 수 있다. 패에서 '펭귄'몬스터 1장을 소환한다.",
        type: "ACTIVATED",
        optional: true,
        sourceZone: "GRAVE",
        cost: [
          {
            type: "BANISH",
            target: "SELF_CARD",
          },
        ],
        resolution: [
          {
            type: "SUMMON",
            from: ["HAND", "PUBLIC_HAND"],
            choice: {
              controller: "SELF",
              cardType: "monster",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
    ],
  },

  PG007: {
    id: "PG007",
    name: "펭귄의 영광",
    cardType: "magic",
    isKeyCard: false,
    theme: "펭귄",

    nonEffectText: [],

    effects: [
      {
        id: 1,
        text: "자신/상대 전개 단계에 발동할 수 있다. 패에서 '펭귄 용사'를 소환하고, 상대 패를 전부 공개한다.",
        type: "QUICK",
        optional: true,
        timing: {
          turn: "EITHER",
          phase: "DEPLOY",
        },
        resolution: [
          {
            type: "SUMMON",
            from: ["HAND", "PUBLIC_HAND"],
            choice: {
              controller: "SELF",
              name: "펭귄 용사",
              nameMatch: "EFFECTIVE",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
          {
            type: "REVEAL_HAND",
            player: "OPPONENT",
            scope: "ALL",
          },
        ],
      },
      {
        id: 2,
        text: "자신 전개 단계에 묘지의 이 카드를 제외하고 발동할 수 있다. 자신은 1장 드로우한다.",
        type: "ACTIVATED",
        optional: true,
        sourceZone: "GRAVE",
        timing: {
          turn: "SELF",
          phase: "DEPLOY",
        },
        cost: [
          {
            type: "BANISH",
            target: "SELF_CARD",
          },
        ],
        resolution: [
          {
            type: "DRAW",
            player: "SELF",
            count: 1,
          },
        ],
      },
    ],
  },

  PG008: {
    id: "PG008",
    name: "펭귄 용사",
    cardType: "monster",
    isKeyCard: true,
    theme: "펭귄",
    atk: 4,

    nonEffectText: [
      {
        text: "이 카드는 상대 필드에 몬스터가 존재할 경우에만 패에 넣을 수 있다.",
        type: "ADD_TO_HAND_CONDITION",
        condition: {
          type: "EXISTS",
          selector: {
            controller: "OPPONENT",
            zones: ["FIELD"],
            cardType: "monster",
          },
        },
      },
      {
        text: "'펭귄의 영광'의 효과나 이 카드의 효과로만 소환할 수 있다.",
        type: "SUMMON_SOURCE_RESTRICTION",
        allowedSources: [
          {
            cardId: "PG007",
            effectId: 1,
          },
          {
            card: "SELF_CARD",
          },
        ],
      },
      {
        text: "1,2효과는 각각 1턴에 1번.",
        type: "EFFECT_LIMIT",
        effectIds: [1, 2],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "이 카드를 소환했을 경우에 발동할 수 있다. 덱에서 '펭귄'카드 1장을 패에 넣고, '펭귄'몬스터 1장을 소환한다. 그 후 패를 1장 버린다.",
        type: "TRIGGER",
        optional: true,
        event: {
          type: "SUMMONED",
          target: "SELF_CARD",
        },
        resolution: [
          {
            type: "SEARCH",
            from: "DECK",
            choice: {
              controller: "SELF",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
          {
            type: "SUMMON",
            from: "DECK",
            choice: {
              controller: "SELF",
              cardType: "monster",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
          {
            type: "DISCARD",
            choice: {
              controller: "SELF",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
      {
        id: 2,
        text: "상대 턴에 발동할 수 있다. 이 카드를 패로 되돌리고, 묘지나 제외 상태의 '펭귄'마법 카드를 1장 패에 넣는다.",
        type: "QUICK",
        optional: true,
        timing: {
          turn: "OPPONENT",
        },
        resolution: [
          {
            type: "RETURN_TO_HAND",
            target: "SELF_CARD",
          },
          {
            type: "SEARCH",
            from: ["GRAVE", "EXILE"],
            choice: {
              controller: "SELF",
              cardType: "magic",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
      {
        id: 3,
        text: "이 카드가 묘지로 보내졌을 경우에 발동할 수 있다. 이 카드를 소환하고, 자신 필드의 모든 '펭귄'몬스터의 공격력을 턴 종료시까지 1씩 올린다.",
        type: "TRIGGER",
        optional: true,
        event: {
          type: "SENT_TO_GRAVE",
          target: "SELF_CARD",
        },
        resolution: [
          {
            type: "SUMMON",
            target: "SELF_CARD",
            from: "GRAVE",
          },
          {
            type: "CHANGE_ATK",
            selector: {
              controller: "SELF",
              zones: ["FIELD"],
              cardType: "monster",
              theme: "펭귄",
              selection: "ALL",
            },
            operation: "ADD",
            value: 1,
            duration: "END_OF_TURN",
          },
        ],
      },
    ],
  },

  PG009: {
    id: "PG009",
    name: "펭귄의 일격",
    cardType: "magic",
    isKeyCard: true,
    theme: "펭귄",

    nonEffectText: [
      {
        text: "이 카드명의 2효과는 1턴에 1번밖에 발동할 수 없다.",
        type: "EFFECT_LIMIT",
        effectIds: [2],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "상대가 몬스터 효과를 발동했을 때 자신 필드에 '펭귄'몬스터가 존재할 경우, 패를 1장 버리고 발동할 수 있다. 그 효과를 무효로 한다.",
        type: "QUICK",
        optional: true,
        event: {
          type: "EFFECT_ACTIVATED",
          controller: "OPPONENT",
          sourceCardType: "monster",
        },
        condition: {
          type: "EXISTS",
          selector: {
            controller: "SELF",
            zones: ["FIELD"],
            cardType: "monster",
            theme: "펭귄",
          },
        },
        cost: [
          {
            type: "DISCARD",
            choice: {
              controller: "SELF",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
        resolution: [
          {
            type: "NEGATE_EFFECT",
            target: "TRIGGERING_EFFECT",
          },
        ],
      },
      {
        id: 2,
        text: "'펭귄 마을'의 효과로 몬스터가 묘지로 보내졌을 경우 발동할 수 있다. 묘지의 이 카드를 패에 넣는다.",
        type: "TRIGGER",
        optional: true,
        sourceZone: "GRAVE",
        event: {
          type: "SENT_TO_GRAVE",
          card: {
            cardType: "monster",
          },
          cause: {
            cardId: "PG001",
            kind: "EFFECT",
          },
        },
        resolution: [
          {
            type: "SEARCH",
            from: "GRAVE",
            selector: {
              card: "SELF_CARD",
            },
          },
        ],
      },
    ],
  },

  PG010: {
    id: "PG010",
    name: "각성의 펭귄 군단",
    cardType: "magic",
    isKeyCard: true,
    theme: "펭귄",
    nonEffectText: [
      {
        text: "이 카드명의 2효과는 1턴에 1번밖에 발동할 수 없다.",
        type: "EFFECT_LIMIT",
        effectIds: [2],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "자신/상대 턴에 발동할 수 있다. 이하의 효과를 원하는 만큼 반복한다. 자신 패를 1장 버리고, 상대 필드의 몬스터를 1장 골라 묘지로 보낸다. 그 후, 묘지의 '펭귄' 몬스터 1장을 소환한다.",
        type: "QUICK",
        optional: true,
        timing: {
          turn: "EITHER",
        },
        resolution: [
          {
            type: "REPEAT",
            mode: "PLAYER_CHOOSES",
            min: 0,
            max: "UNBOUNDED",
            continueWhileAllActionsLegal: true,
            actions: [
              {
                type: "DISCARD",
                choice: {
                  controller: "SELF",
                  zones: ["HAND", "PUBLIC_HAND"],
                  count: {
                    min: 1,
                    max: 1,
                  },
                },
              },
              {
                type: "SEND_TO_GRAVE",
                choice: {
                  controller: "OPPONENT",
                  zones: ["FIELD"],
                  cardType: "monster",
                  count: {
                    min: 1,
                    max: 1,
                  },
                },
              },
              {
                type: "SUMMON",
                from: "GRAVE",
                choice: {
                  controller: "SELF",
                  cardType: "monster",
                  theme: "펭귄",
                  count: {
                    min: 1,
                    max: 1,
                  },
                },
              },
            ],
          },
        ],
      },
      {
        id: 2,
        text: "자신 필드의 '펭귄' 몬스터가 '펭귄 마을'의 효과로 묘지로 보내졌을 경우 발동할 수 있다. 묘지의 이 카드를 패에 넣는다.",
        type: "TRIGGER",
        optional: true,
        sourceZone: "GRAVE",
        event: {
          type: "SENT_TO_GRAVE",
          card: {
            controller: "SELF",
            cardType: "monster",
            theme: "펭귄",
          },
          cause: {
            cardId: "PG001",
            kind: "EFFECT",
          },
        },
        resolution: [
          {
            type: "SEARCH",
            from: "GRAVE",
            selector: {
              card: "SELF_CARD",
            },
          },
        ],
      },
    ],
  },

  PG011: {
    id: "PG011",
    name: "평화의 펭귄",
    cardType: "magic",
    isKeyCard: true,
    theme: "펭귄",

    nonEffectText: [
      {
        text: "이 카드명의 1, 2효과는 각각 1턴에 1번밖에 발동할 수 없다.",
        type: "EFFECT_LIMIT",
        effectIds: [1, 2],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "상대가 효과를 발동했을 때 상대 필드의 몬스터 1장을 대상으로 발동할 수 있다. 자신 필드의 '펭귄' 몬스터의 공격력을 각각 그 몬스터의 공격력의 절반만큼 올린다(소수점 아래는 올림).",
        type: "QUICK",
        optional: true,
        event: {
          type: "EFFECT_ACTIVATED",
          controller: "OPPONENT",
        },
        target: {
          id: "targetMonster",
          selector: {
            controller: "OPPONENT",
            zones: ["FIELD"],
            cardType: "monster",
            count: {
              min: 1,
              max: 1,
            },
          },
        },
        resolution: [
          {
            type: "CHANGE_ATK",
            selector: {
              controller: "SELF",
              zones: ["FIELD"],
              cardType: "monster",
              theme: "펭귄",
              selection: "ALL",
            },
            operation: "ADD",
            value: {
              type: "CEIL",
              value: {
                type: "DIVIDE",
                left: {
                  type: "STAT",
                  targetRef: "targetMonster",
                  stat: "ATK",
                },
                right: 2,
              },
            },
          },
        ],
      },
      {
        id: 2,
        text: "묘지의 이 카드를 제외하고 발동할 수 있다. 덱에서 '펭귄 마을' 1장을 패에 넣는다. 그 후 패를 1장 고르고 버린다.",
        type: "ACTIVATED",
        optional: true,
        sourceZone: "GRAVE",
        cost: [
          {
            type: "BANISH",
            target: "SELF_CARD",
          },
        ],
        resolution: [
          {
            type: "SEARCH",
            from: "DECK",
            choice: {
              controller: "SELF",
              cardId: "PG001",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
          {
            type: "DISCARD",
            choice: {
              controller: "SELF",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
    ],
  },

  PG012: {
    id: "PG012",
    name: "펭귄이여 영원하라",
    cardType: "magic",
    isKeyCard: false,
    theme: "펭귄",

    nonEffectText: [
      {
        text: "이 카드의 카드명은 묘지/제외 상태에서 '펭귄의 영광'으로 취급한다.",
        type: "TREAT_NAME_AS",
        name: "펭귄의 영광",
        cardId: "PG007",
        zones: ["GRAVE", "EXILE"],
      },
      {
        text: "1효과는 1턴에 1번.",
        type: "EFFECT_LIMIT",
        effectIds: [1],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "서로의 필드의 카드를 1장씩 대상으로 하고 발동할 수 있다. 그 카드를 패로 되돌린다. 그 후, 패에서 '펭귄'몬스터 1장을 소환할 수 있다.",
        type: "ACTIVATED",
        optional: true,
        target: {
          groups: [
            {
              id: "myTarget",
              selector: {
                controller: "SELF",
                zones: ["FIELD"],
                count: {
                  min: 1,
                  max: 1,
                },
              },
            },
            {
              id: "opponentTarget",
              selector: {
                controller: "OPPONENT",
                zones: ["FIELD"],
                count: {
                  min: 1,
                  max: 1,
                },
              },
            },
          ],
        },
        resolution: [
          {
            type: "RETURN_TO_HAND",
            targetRefs: ["myTarget", "opponentTarget"],
          },
          {
            type: "SUMMON",
            optional: true,
            from: ["HAND", "PUBLIC_HAND"],
            choice: {
              controller: "SELF",
              cardType: "monster",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
      {
        id: 2,
        text: "상대 턴에, 묘지의 이 카드를 제외하고 발동할 수 있다. 패에서 '펭귄'몬스터 1장을 소환한다.",
        type: "QUICK",
        optional: true,
        sourceZone: "GRAVE",
        timing: {
          turn: "OPPONENT",
        },
        cost: [
          {
            type: "BANISH",
            target: "SELF_CARD",
          },
        ],
        resolution: [
          {
            type: "SUMMON",
            from: ["HAND", "PUBLIC_HAND"],
            choice: {
              controller: "SELF",
              cardType: "monster",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
    ],
  },

  PG013: {
    id: "PG013",
    name: "펭귄의 전설",
    cardType: "monster",
    isKeyCard: true,
    theme: "펭귄",
    atk: 5,

    nonEffectText: [
      {
        text: "자신 필드에 몬스터가 존재할 경우에만 패에 넣을 수 있다.",
        type: "ADD_TO_HAND_CONDITION",
        condition: {
          type: "EXISTS",
          selector: {
            controller: "SELF",
            zones: ["FIELD"],
            cardType: "monster",
          },
        },
      },
      {
        text: "패에서 카드명을 '펭귄 용사'로 취급한다.",
        type: "TREAT_NAME_AS",
        name: "펭귄 용사",
        cardId: "PG008",
        zones: ["HAND", "PUBLIC_HAND"],
      },
      {
        text: "'펭귄의 영광'의 효과로만 소환할 수 있다.",
        type: "SUMMON_SOURCE_RESTRICTION",
        allowedSources: [
          {
            cardId: "PG007",
            effectId: 1,
          },
        ],
      },
      {
        text: "1,2효과는 각각 1턴에 1번.",
        type: "EFFECT_LIMIT",
        effectIds: [1, 2],
        mode: "EACH",
        scope: "TURN",
        count: 1,
      },
    ],

    effects: [
      {
        id: 1,
        text: "이 카드를 소환했을 경우에 발동할 수 있다. 묘지에서 '꼬마 펭귄'을 2장까지 소환한다.",
        type: "TRIGGER",
        optional: true,
        event: {
          type: "SUMMONED",
          target: "SELF_CARD",
        },
        resolution: [
          {
            type: "SUMMON",
            from: "GRAVE",
            choice: {
              controller: "SELF",
              cardId: "PG002",
              count: {
                min: 0,
                max: 2,
              },
            },
          },
        ],
      },
      {
        id: 2,
        text: "상대 턴에 발동할 수 있다. 이 카드를 패로 되돌리고, 묘지나 제외 상태의 '펭귄'몬스터 1장을 소환한다.",
        type: "QUICK",
        optional: true,
        timing: {
          turn: "OPPONENT",
        },
        resolution: [
          {
            type: "RETURN_TO_HAND",
            target: "SELF_CARD",
          },
          {
            type: "SUMMON",
            from: ["GRAVE", "EXILE"],
            choice: {
              controller: "SELF",
              cardType: "monster",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
      {
        id: 3,
        text: "이 카드는 이 카드를 대상으로 하지 않는 상대 카드의 효과를 받지 않는다.",
        type: "CONTINUOUS",
        apply: {
          type: "EFFECT_IMMUNITY",
          target: "SELF_CARD",
          sourceController: "OPPONENT",
          condition: {
            type: "SOURCE_EFFECT_DOES_NOT_TARGET",
            target: "SELF_CARD",
          },
        },
      },
    ],
  },

  PG014: {
    id: "PG014",
    name: "펭귄 마법사",
    cardType: "monster",
    isKeyCard: false,
    theme: "펭귄",
    atk: 3,

    nonEffectText: [
      {
        text: "1,2,3효과는 각각 1턴에 2번까지 발동할 수 있다.",
        type: "EFFECT_LIMIT",
        effectIds: [1, 2, 3],
        mode: "EACH",
        scope: "TURN",
        count: 2,
      },
    ],

    effects: [
      {
        id: 1,
        text: "일반 패인 이 카드를 보여주고 발동할 수 있다. 덱에서 '펭귄'카드 1장을 패에 넣는다. 그 후, 이 카드를 덱으로 되돌린다.",
        type: "ACTIVATED",
        optional: true,
        sourceZone: "HAND",
        cost: [
          {
            type: "REVEAL",
            target: "SELF_CARD",
          },
        ],
        resolution: [
          {
            type: "SEARCH",
            from: "DECK",
            choice: {
              controller: "SELF",
              theme: "펭귄",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
          {
            type: "RETURN_TO_DECK",
            target: "SELF_CARD",
          },
        ],
      },
      {
        id: 2,
        text: "이 카드를 소환했을 경우에 발동할 수 있다. 패를 3장까지 버리고, 그 수까지 상대 필드의 몬스터를 제외한다.",
        type: "TRIGGER",
        optional: true,
        event: {
          type: "SUMMONED",
          target: "SELF_CARD",
        },
        resolution: [
          {
            type: "DISCARD",
            choice: {
              controller: "SELF",
              zones: ["HAND", "PUBLIC_HAND"],
              count: {
                min: 0,
                max: 3,
              },
            },
            storeAs: "discardedCount",
          },
          {
            type: "BANISH",
            choice: {
              controller: "OPPONENT",
              zones: ["FIELD"],
              cardType: "monster",
              count: {
                min: 0,
                max: {
                  type: "RESULT_COUNT",
                  ref: "discardedCount",
                },
              },
            },
          },
        ],
      },
      {
        id: 3,
        text: "'펭귄 마을'의 효과로 몬스터가 묘지로 보내졌을 경우 발동할 수 있다. 자신/상대의 제외 상태의 몬스터 1장을 골라 소환한다.",
        type: "TRIGGER",
        optional: true,
        event: {
          type: "SENT_TO_GRAVE",
          card: {
            cardType: "monster",
          },
          cause: {
            cardId: "PG001",
            kind: "EFFECT",
          },
        },
        resolution: [
          {
            type: "SUMMON",
            from: "EXILE",
            choice: {
              controller: "EITHER",
              owner: "EITHER",
              cardType: "monster",
              count: {
                min: 1,
                max: 1,
              },
            },
          },
        ],
      },
    ],
  },
};