'use strict';
const FORMATS = {
  daily_briefing: { id: 'daily_briefing', title: 'Daily Briefing', targetSec: [180, 360], stories: [5, 8], humor: true, maxJokes: 2, aspect: '16:9' },
  shorts:         { id: 'shorts', title: 'Shorts', targetSec: [30, 58], stories: [1, 1], humor: true, maxJokes: 1, aspect: '9:16' },
  space_tech:     { id: 'space_tech', title: 'Space & Tech', targetSec: [120, 300], stories: [3, 6], humor: true, maxJokes: 2, aspect: '16:9' },
  breaking:       { id: 'breaking', title: 'Breaking', targetSec: [30, 120], stories: [1, 1], humor: false, maxJokes: 0, confirmedOnly: true, emotion: 'SERIOUS', aspect: '16:9' },
};
const PIPELINE = ['news', 'fact_verification', 'script_editor', 'humor_safety', 'voice_emotion', 'video', 'qa', 'approval'];
module.exports = { FORMATS, PIPELINE };
