export const quoteCategories = [
  "morning", "night", "goal_start", "incomplete_goals", "streak",
  "completion", "progress", "consistency", "comeback", "focus",
] as const;

const seeds: Record<(typeof quoteCategories)[number], string[]> = {
  morning: [
    "beginning with one clear intention", "choosing the first task before checking the noise",
    "making room for a slower breath", "turning ten quiet minutes into useful ground",
    "waking your attention before opening every tab", "writing down the next honest step",
    "letting daylight meet a simple plan", "starting before the whole day is solved",
    "giving your best energy one place to land", "leaving a little space between waking and rushing",
  ],
  night: [
    "closing today with a kinder measure", "setting tomorrow's first step within reach",
    "letting unfinished work wait without taking your rest", "noticing what moved forward before the lights dim",
    "choosing one small preparation over a perfect plan", "making peace with the pace you kept",
    "putting tomorrow's intention somewhere you can find it", "giving the day a calm and useful ending",
    "remembering that rest protects tomorrow's attention", "ending with gratitude for one thing you tried",
  ],
  goal_start: [
    "naming a goal small enough to begin", "turning a wish into a visible next action",
    "choosing a target that gives effort direction", "starting with the part you can do today",
    "making the first step clear enough to repeat", "giving your intention a time and a place",
    "trading a vague hope for one useful measure", "beginning before confidence feels complete",
    "choosing progress you can honestly track", "letting a modest start become a real promise",
  ],
  incomplete_goals: [
    "returning to the step that still matters", "doing one useful piece before judging the whole",
    "making progress without waiting for a perfect mood", "reducing the next task until it feels possible",
    "giving unfinished work a fresh and smaller entrance", "choosing a few minutes of effort over another delay",
    "moving one goal forward by a measurable amount", "starting again without turning a pause into a verdict",
    "placing attention on what remains within reach", "finishing one piece before adding another plan",
  ],
  streak: [
    "protecting a practice you built one day at a time", "showing up once more for the promise you keep",
    "letting today's small action honor yesterday's effort", "making continuity feel steady instead of heavy",
    "keeping the chain alive with a task that fits today", "returning before momentum has to be rebuilt",
    "giving your routine one more honest repetition", "letting a brief focused effort count as a return",
    "carrying your progress forward with a simple choice", "keeping faith with the practice that matters to you",
  ],
  completion: [
    "recognizing the care behind work brought to its end", "letting a finished goal be proof of your follow-through",
    "pausing long enough to take in what you completed", "celebrating the steps that made this result possible",
    "giving today's effort the credit it has earned", "making room for pride without rushing to the next thing",
    "seeing a completed target as evidence of steady choices", "marking this finish as part of a larger practice",
    "honoring the focus that carried you across the line", "enjoying the satisfaction of a promise kept",
  ],
  progress: [
    "counting the distance already traveled", "noticing a small change that used to be only an idea",
    "measuring today's effort against your own starting point", "letting each page or minute become visible proof",
    "seeing partial progress as information and encouragement", "giving the next fraction of effort a clear direction",
    "recognizing movement even when the finish is far away", "keeping track of steps that are easy to overlook",
    "using what you have done to guide what comes next", "treating a little forward motion as real evidence",
  ],
  consistency: [
    "returning to the work at a pace you can sustain", "making the useful choice often enough to trust it",
    "building a routine from actions that fit ordinary days", "choosing repeatable effort over a brief burst",
    "letting small commitments become dependable habits", "showing up in a way that leaves room for tomorrow",
    "keeping your practice steady when the day is unremarkable", "making reliability more important than intensity",
    "repeating the next good step until it feels familiar", "protecting your rhythm with a promise you can keep",
  ],
  comeback: [
    "returning without requiring an explanation from yourself", "letting one fresh action interrupt a long pause",
    "beginning again from the person you are today", "making the way back smaller than the way you left",
    "meeting this moment without carrying yesterday's judgment", "choosing a return that asks only for the next step",
    "reopening a goal as an invitation rather than a debt", "using a quiet restart to change the direction of a day",
    "remembering that a pause does not erase what you learned", "giving your attention another place to begin",
  ],
  focus: [
    "giving one task the whole of this short interval", "moving distractions aside until the next step is clear",
    "staying with the work long enough to find its rhythm", "choosing depth over another quick glance elsewhere",
    "letting a single intention guide your attention", "making this stretch of time belong to one useful thing",
    "returning your mind gently whenever it wanders", "keeping the workspace quiet enough for thought to settle",
    "starting with the action directly in front of you", "protecting a few minutes for work that deserves care",
  ],
};

const frames: Record<(typeof quoteCategories)[number], ((seed: string) => string)[]> = {
  morning: [
    seed => `The morning becomes yours when you try ${seed}.`,
    seed => `Give this morning a shape by ${seed}.`,
    seed => `A clear start can be as small as ${seed}.`,
    seed => `Let the first hour stay simple: ${seed}.`,
    seed => `Today opens with a choice: ${seed}.`,
  ],
  night: [
    seed => `Let tonight make room for ${seed}.`,
    seed => `The day can settle gently by ${seed}.`,
    seed => `A quieter ending begins with ${seed}.`,
    seed => `Before rest, consider ${seed}.`,
    seed => `Tomorrow gets a softer start when you try ${seed}.`,
  ],
  goal_start: [
    seed => `A goal becomes workable by ${seed}.`,
    seed => `Give your intention direction through ${seed}.`,
    seed => `The first sign of commitment is ${seed}.`,
    seed => `Let your next goal begin with ${seed}.`,
    seed => `Clarity grows when you try ${seed}.`,
  ],
  incomplete_goals: [
    seed => `An unfinished goal can move again through ${seed}.`,
    seed => `Make a little room for progress by ${seed}.`,
    seed => `The next useful move may be ${seed}.`,
    seed => `You can meet this goal again by ${seed}.`,
    seed => `A smaller return is still a way forward: ${seed}.`,
  ],
  streak: [
    seed => `Keep your rhythm alive by ${seed}.`,
    seed => `Continuity grows each time you try ${seed}.`,
    seed => `Today can carry yesterday's effort through ${seed}.`,
    seed => `A steady practice is renewed by ${seed}.`,
    seed => `Let one more day count through ${seed}.`,
  ],
  completion: [
    seed => `This finish deserves a moment for ${seed}.`,
    seed => `Let completion feel real by ${seed}.`,
    seed => `Your follow-through is visible in ${seed}.`,
    seed => `A goal reached makes space for ${seed}.`,
    seed => `Take this result with you by ${seed}.`,
  ],
  progress: [
    seed => `Progress becomes easier to trust by ${seed}.`,
    seed => `A useful measure can help you with ${seed}.`,
    seed => `Look closely and you may find ${seed}.`,
    seed => `The next step gets clearer through ${seed}.`,
    seed => `Let evidence encourage you by ${seed}.`,
  ],
  consistency: [
    seed => `A durable rhythm grows from ${seed}.`,
    seed => `Consistency is practiced by ${seed}.`,
    seed => `Make tomorrow easier by ${seed}.`,
    seed => `A habit becomes dependable through ${seed}.`,
    seed => `Let steady effort take the shape of ${seed}.`,
  ],
  comeback: [
    seed => `The way back can begin with ${seed}.`,
    seed => `There is room to restart by ${seed}.`,
    seed => `A pause can end gently through ${seed}.`,
    seed => `Meet this return with ${seed}.`,
    seed => `Your next chapter may start by ${seed}.`,
  ],
  focus: [
    seed => `Attention settles more easily through ${seed}.`,
    seed => `Give the present task room by ${seed}.`,
    seed => `Focused work begins with ${seed}.`,
    seed => `Let this interval become useful through ${seed}.`,
    seed => `One clear intention can grow from ${seed}.`,
  ],
};

export const quoteLibrary = quoteCategories.flatMap(category =>
  seeds[category].flatMap((seed, seedIndex) =>
    frames[category].map((frame, frameIndex) => ({
      id: `${category}-${String(seedIndex * frames[category].length + frameIndex + 1).padStart(3, "0")}`,
      category,
      text: frame(seed),
    }))
  )
);
