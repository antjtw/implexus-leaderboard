// Implexus Powerlifting — change log (rolling 7-day window)
// Written automatically by scripts/scrape.mjs on each daily run.
// generated:      ISO timestamp of the run that produced this file.
// baselineDate:   when the current rank baseline was set (refreshed every 7 days).
// prevRankActive / prevRankAll: slug -> rank as of baselineDate, RE-RANKED over
//   the current roster so arrivals/departures don't create phantom arrows.
//   Position arrows compare current rank against these, so only genuine
//   lifting-driven movement shows — roster logistics net to zero.
// rosterActive / rosterAll: the slugs present at this run (roster-change basis).
// arrivals / departures:    who joined / left since the baseline (stored for
//   possible future use; not displayed). Arrivals show as NEW, not as movers.
// pbEvents:       personal-best improvements from the last 7 days, each stamped
//   with the date it hit the board. Shown as callout cards in dynamic mode,
//   ageing out after 7 days. A new PB for a lifter overrides their older one.

const CHANGES = {
  "generated": "2026-11-08T16:49:05.962Z",
  "baselineDate": "2026-11-03T18:07:56.979Z",
  "prevRankActive": {
    "wyliesung": 1,
    "mikejones1": 2,
    "genevievecollins": 3,
    "chrisjennings": 4,
    "peterking1": 5,
    "anthonywhite1": 6,
    "nickjohnstone": 7,
    "taliafirth": 8,
    "ashlingkeeble": 9,
    "stevewhittles": 10,
    "williamwebb1": 11,
    "leemccafferty": 12,
    "tobysolomon": 13,
    "joecurzon": 14,
    "chloeboomer": 15,
    "violetclarkewaller": 16,
    "matthewanderson2": 17,
    "owencrisp": 18,
    "johncousins1": 19,
    "robjacobs": 20,
    "jodiebarnsley": 21,
    "jacklarkinsthomas": 22,
    "laurajones6": 23
  },
  "prevRankAll": {
    "wyliesung": 1,
    "mikejones1": 2,
    "anneburns": 3,
    "maxguo": 4,
    "victoriahart": 5,
    "chrisonuoha": 6,
    "gerryleepierre": 7,
    "kairichardson": 8,
    "genevievecollins": 9,
    "chrisjennings": 10,
    "joshhinchcliffe": 11,
    "benthornes": 12,
    "karldaniel": 13,
    "peterking1": 14,
    "bradycrooks": 15,
    "anthonymclaughlin1": 16,
    "anthonywhite1": 17,
    "samriddharanjan": 18,
    "nickjohnstone": 19,
    "taliafirth": 20,
    "ashlingkeeble": 21,
    "stevewhittles": 22,
    "leohannan": 23,
    "williamwebb1": 24,
    "leemccafferty": 25,
    "alexshortland": 26,
    "tobysolomon": 27,
    "joecurzon": 28,
    "chloeboomer": 29,
    "violetclarkewaller": 30,
    "finndavis": 31,
    "matthewanderson2": 32,
    "owencrisp": 33,
    "johncousins1": 34,
    "samlusher": 35,
    "robjacobs": 36,
    "roryturnbull": 37,
    "kellybroadbent": 38,
    "jodiebarnsley": 39,
    "jacklarkinsthomas": 40,
    "laurajones6": 41
  },
  "curRankActive": {
    "wyliesung": 1,
    "mikejones1": 2,
    "genevievecollins": 3,
    "chrisjennings": 4,
    "peterking1": 5,
    "anthonywhite1": 6,
    "nickjohnstone": 7,
    "taliafirth": 8,
    "ashlingkeeble": 9,
    "stevewhittles": 10,
    "williamwebb1": 11,
    "leemccafferty": 12,
    "tobysolomon": 13,
    "joecurzon": 14,
    "chloeboomer": 15,
    "violetclarkewaller": 16,
    "matthewanderson2": 17,
    "owencrisp": 18,
    "johncousins1": 19,
    "robjacobs": 20,
    "jodiebarnsley": 21,
    "jacklarkinsthomas": 22,
    "laurajones6": 23
  },
  "curRankAll": {
    "wyliesung": 1,
    "mikejones1": 2,
    "anneburns": 3,
    "maxguo": 4,
    "victoriahart": 5,
    "chrisonuoha": 6,
    "gerryleepierre": 7,
    "kairichardson": 8,
    "genevievecollins": 9,
    "chrisjennings": 10,
    "joshhinchcliffe": 11,
    "benthornes": 12,
    "karldaniel": 13,
    "peterking1": 14,
    "bradycrooks": 15,
    "anthonymclaughlin1": 16,
    "anthonywhite1": 17,
    "samriddharanjan": 18,
    "nickjohnstone": 19,
    "taliafirth": 20,
    "ashlingkeeble": 21,
    "stevewhittles": 22,
    "leohannan": 23,
    "williamwebb1": 24,
    "leemccafferty": 25,
    "alexshortland": 26,
    "tobysolomon": 27,
    "joecurzon": 28,
    "chloeboomer": 29,
    "violetclarkewaller": 30,
    "finndavis": 31,
    "matthewanderson2": 32,
    "owencrisp": 33,
    "johncousins1": 34,
    "samlusher": 35,
    "robjacobs": 36,
    "roryturnbull": 37,
    "kellybroadbent": 38,
    "jodiebarnsley": 39,
    "jacklarkinsthomas": 40,
    "laurajones6": 41
  },
  "rosterActive": [
    "wyliesung",
    "mikejones1",
    "genevievecollins",
    "chrisjennings",
    "anthonywhite1",
    "nickjohnstone",
    "taliafirth",
    "stevewhittles",
    "williamwebb1",
    "ashlingkeeble",
    "joecurzon",
    "tobysolomon",
    "matthewanderson2",
    "owencrisp",
    "jodiebarnsley",
    "laurajones6",
    "jacklarkinsthomas",
    "peterking1",
    "robjacobs",
    "johncousins1",
    "leemccafferty",
    "chloeboomer",
    "violetclarkewaller"
  ],
  "rosterAll": [
    "wyliesung",
    "mikejones1",
    "genevievecollins",
    "chrisjennings",
    "anthonywhite1",
    "nickjohnstone",
    "taliafirth",
    "stevewhittles",
    "williamwebb1",
    "ashlingkeeble",
    "joecurzon",
    "tobysolomon",
    "matthewanderson2",
    "owencrisp",
    "jodiebarnsley",
    "laurajones6",
    "jacklarkinsthomas",
    "peterking1",
    "robjacobs",
    "johncousins1",
    "leemccafferty",
    "chloeboomer",
    "finndavis",
    "kairichardson",
    "leohannan",
    "samlusher",
    "chrisonuoha",
    "alexshortland",
    "kellybroadbent",
    "roryturnbull",
    "gerryleepierre",
    "karldaniel",
    "bradycrooks",
    "anthonymclaughlin1",
    "samriddharanjan",
    "anneburns",
    "maxguo",
    "victoriahart",
    "joshhinchcliffe",
    "benthornes",
    "violetclarkewaller",
    "adeomisakin"
  ],
  "arrivals": [],
  "departures": [],
  "pbEvents": [
    {
      "slug": "laurajones6",
      "name": "Laura Jones",
      "improved": {
        "squat": {
          "from": 82.5,
          "to": 87.5
        },
        "bench": {
          "from": 45,
          "to": 47.5
        },
        "deadlift": {
          "from": 117.5,
          "to": 122.5
        },
        "total": {
          "from": 245,
          "to": 257.5
        }
      },
      "dots": {
        "from": 245.62,
        "to": 259.16
      },
      "date": "2026-11-01T16:56:11.888Z"
    },
    {
      "slug": "jacklarkinsthomas",
      "name": "Jack Larkins-Thomas",
      "improved": {
        "squat": {
          "from": 160,
          "to": 180
        },
        "bench": {
          "from": 82.5,
          "to": 92.5
        },
        "deadlift": {
          "from": 180,
          "to": 195
        },
        "total": {
          "from": 422.5,
          "to": 467.5
        }
      },
      "dots": {
        "from": 245.91,
        "to": 267.53
      },
      "date": "2026-11-01T16:56:11.888Z"
    },
    {
      "slug": "mikejones1",
      "name": "Mike Jones",
      "improved": {
        "deadlift": {
          "from": 355,
          "to": 360
        }
      },
      "dots": {
        "from": 535.63,
        "to": 535.63
      },
      "date": "2026-11-02T20:33:21.908Z"
    },
    {
      "slug": "kairichardson",
      "name": "Kai Richardson",
      "improved": {
        "total": {
          "from": 642.5,
          "to": 655
        }
      },
      "dots": {
        "from": 450.21,
        "to": 469.51
      },
      "date": "2026-11-02T20:33:21.908Z"
    }
  ]
};
