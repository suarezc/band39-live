/* Vexo Companion · life-event scenarios (data only).
 * Each scenario jumps the scene clock to `start`, runs at `speed` (scene seconds per real
 * second), and plays `steps`. A step fires at scene time `at` ("HH:MM"), or `wait` real
 * seconds after the step before it. Actions are band-level: they are played on the kit's
 * pretend band (SimTransport), so the data reaches the app through the real protocol.
 *   activity: 'still' | 'walk' | 'run'   (+ addSteps)
 *   gesture:  'tap' | 'double-tap' | 'free-fall' | 'tilt' | 'motion-start' | 'motion-stop'
 *   offWrist: true | false               battery: percent (+ state)
 *   rssi:     dBm | null                 dropLink: seconds
 *   message:  text from Lisa             reply: text from Margaret
 */
(function (root) {
  'use strict';
  const SCENARIOS = [
    {
      id: 'morning', icon: '☀️', title: 'An ordinary morning',
      blurb: 'Pill reminder at 8:00, confirmed with a tap. A walk, then a note from Lisa.',
      start: '07:50', speed: 60,
      steps: [
        { at: '07:50', do: 'activity', arg: 'still' },
        { at: '08:03', do: 'gesture', arg: 'tap', note: 'Margaret taps her band: pills taken' },
        { at: '08:20', do: 'activity', arg: 'walk', addSteps: 900, note: 'Off to the bakery' },
        { at: '08:55', do: 'activity', arg: 'still', addSteps: 1400 },
        { at: '09:10', do: 'message', arg: 'Morning Mom! Visiting Saturday 🌷' },
        { wait: 5, do: 'gesture', arg: 'tap', note: 'Margaret taps to say she read it' },
        { wait: 2, do: 'reply', arg: 'Lovely! See you Saturday ❤️' },
      ],
    },
    {
      id: 'fall-ok', icon: '🫶', title: 'A fall, and she’s OK',
      blurb: 'A sudden drop in the kitchen. The band asks; Margaret double-taps “I’m OK”.',
      start: '10:36', speed: 30,
      steps: [
        { at: '10:36', do: 'activity', arg: 'walk', addSteps: 200 },
        { at: '10:42', do: 'gesture', arg: 'free-fall', note: 'The band feels a sudden drop' },
        { wait: 0.5, do: 'activity', arg: 'still' },
        { wait: 6, do: 'gesture', arg: 'double-tap', note: 'Margaret double-taps: I’m OK' },
      ],
    },
    {
      id: 'fall-silent', icon: '🚨', title: 'A fall with no answer',
      blurb: 'Same drop, but no reply in 20 seconds. Lisa gets an urgent alert.',
      start: '15:08', speed: 30,
      steps: [
        { at: '15:08', do: 'activity', arg: 'walk', addSteps: 150 },
        { at: '15:12', do: 'gesture', arg: 'free-fall', note: 'Sudden drop on the stairs' },
        { wait: 0.5, do: 'activity', arg: 'still' },
        { wait: 21, do: 'note', note: 'No answer: the app escalates to Lisa' },
      ],
    },
    {
      id: 'night', icon: '🌙', title: 'Up in the night',
      blurb: 'Walking at 2:40 am. A soft glow suggests bed; Lisa hears about it once.',
      start: '02:30', speed: 45,
      steps: [
        { at: '02:30', do: 'activity', arg: 'still' },
        { at: '02:40', do: 'gesture', arg: 'motion-start' },
        { wait: 0.2, do: 'activity', arg: 'walk', addSteps: 60, note: 'Margaret gets up and walks to the hall' },
        { at: '02:52', do: 'activity', arg: 'still', note: 'She heads back to bed' },
        { at: '03:10', do: 'note', note: 'Back to rest' },
      ],
    },
    {
      id: 'missed-pills', icon: '💊', title: 'Evening pills forgotten',
      blurb: 'The 8 pm reminder glows amber for 45 minutes with no tap. Lisa gets a nudge.',
      start: '19:52', speed: 150,
      steps: [
        { at: '19:52', do: 'activity', arg: 'still' },
        { at: '20:50', do: 'note', note: 'No tap: pills marked “not confirmed”' },
      ],
    },
    {
      id: 'quiet', icon: '🤍', title: 'Too quiet an afternoon',
      blurb: 'Three hours without moving. A check-in goes unanswered, so Lisa is told.',
      start: '11:00', speed: 400,
      steps: [
        { at: '11:00', do: 'activity', arg: 'still' },
        { at: '14:05', do: 'note', note: 'Check-in on the band and the screen' },
      ],
    },
    {
      id: 'nightstand', icon: '⌚', title: 'Band left on the nightstand',
      blurb: 'Perfectly still for two hours. Not a fall, just not worn. Gentle reminder.',
      start: '09:00', speed: 600,
      steps: [
        { at: '09:00', do: 'activity', arg: 'still' },
        { at: '09:01', do: 'offWrist', arg: true, note: 'The band lies flat on the nightstand' },
        { at: '11:20', do: 'offWrist', arg: false, note: 'Margaret puts it back on' },
        { wait: 0.3, do: 'activity', arg: 'walk', addSteps: 40 },
      ],
    },
    {
      id: 'walk', icon: '🌳', title: 'Walk to the park',
      blurb: 'Out of the house for an hour. 3,000 steps reached; back home by 2.',
      start: '12:55', speed: 90,
      steps: [
        { at: '12:55', do: 'activity', arg: 'still' },
        { at: '13:00', do: 'activity', arg: 'walk', addSteps: 300, note: 'Margaret heads out' },
        { at: '13:06', do: 'rssi', arg: -91, note: 'Out of range of the home tablet' },
        { at: '13:30', do: 'activity', arg: 'walk', addSteps: 1800 },
        { at: '13:50', do: 'activity', arg: 'walk', addSteps: 1100 },
        { at: '14:02', do: 'rssi', arg: null, note: 'Home again' },
        { wait: 0.3, do: 'activity', arg: 'still' },
      ],
    },
    {
      id: 'battery', icon: '🪫', title: 'Battery runs low',
      blurb: 'Down to 18% in the evening. Both screens remind; then it goes on the charger.',
      start: '20:40', speed: 60,
      steps: [
        { at: '20:40', do: 'battery', arg: 26 },
        { at: '20:52', do: 'battery', arg: 18, note: 'Battery under 20%' },
        { at: '21:20', do: 'battery', arg: 19, state: 'charging', note: 'Margaret plugs it in' },
      ],
    },
  ];
  const VexoScenarios = { SCENARIOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = VexoScenarios;
  else root.VexoScenarios = VexoScenarios;
})(typeof window !== 'undefined' ? window : globalThis);
