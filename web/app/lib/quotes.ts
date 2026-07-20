/**
 * Curated motivational quotes for the dashboard's editorial "voice" moment.
 * Deliberately substance over saccharine, workplace-appropriate. Rotated
 * DETERMINISTICALLY by calendar date — the same quote for everyone on a given
 * day, changing the next day (never random per page load). One-file edit to
 * add/remove; keep the list at ~60-100 so repetition isn't noticeable.
 */
export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: Quote[] = [
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { text: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Whatever you are, be a good one.', author: 'Abraham Lincoln' },
  { text: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman' },
  { text: 'Great things are done by a series of small things brought together.', author: 'Vincent van Gogh' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Do not wait to strike till the iron is hot; make it hot by striking.', author: 'W. B. Yeats' },
  { text: 'Amateurs sit and wait for inspiration; the rest of us just get up and go to work.', author: 'Stephen King' },
  { text: 'Discipline is choosing between what you want now and what you want most.', author: 'Abraham Lincoln' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { text: 'What gets measured gets managed.', author: 'Peter Drucker' },
  { text: 'Efficiency is doing things right; effectiveness is doing the right things.', author: 'Peter Drucker' },
  { text: 'Plans are only good intentions unless they immediately degenerate into hard work.', author: 'Peter Drucker' },
  { text: 'Excellence is never an accident. It is the result of high intention and intelligent execution.', author: 'Aristotle' },
  { text: 'Success is the sum of small efforts repeated day in and day out.', author: 'Robert Collier' },
  { text: 'Action is the foundational key to all success.', author: 'Pablo Picasso' },
  { text: 'You do not have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
  { text: 'The expert in anything was once a beginner.', author: 'Helen Hayes' },
  { text: 'Continuous improvement is better than delayed perfection.', author: 'Mark Twain' },
  { text: 'A goal without a plan is just a wish.', author: 'Antoine de Saint-Exupéry' },
  { text: 'If you want to go fast, go alone. If you want to go far, go together.', author: 'African proverb' },
  { text: 'The strength of the team is each member. The strength of each member is the team.', author: 'Phil Jackson' },
  { text: 'Alone we can do so little; together we can do so much.', author: 'Helen Keller' },
  { text: 'Coming together is a beginning, staying together is progress, working together is success.', author: 'Henry Ford' },
  { text: 'Quality means doing it right when no one is looking.', author: 'Henry Ford' },
  { text: 'Whether you think you can, or you think you cannot — you are right.', author: 'Henry Ford' },
  { text: 'Do the hard jobs first. The easy jobs will take care of themselves.', author: 'Dale Carnegie' },
  { text: 'Our greatest weakness lies in giving up. The certain way to succeed is always to try just once more.', author: 'Thomas Edison' },
  { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', author: 'Thomas Edison' },
  { text: 'I have not failed. I have just found ten thousand ways that will not work.', author: 'Thomas Edison' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Innovation distinguishes between a leader and a follower.', author: 'Steve Jobs' },
  { text: 'Details matter, it is worth waiting to get it right.', author: 'Steve Jobs' },
  { text: 'Perfection is not attainable, but if we chase perfection we can catch excellence.', author: 'Vince Lombardi' },
  { text: 'The price of success is hard work and dedication to the job at hand.', author: 'Vince Lombardi' },
  { text: 'Motivation gets you going; discipline keeps you growing.', author: 'John C. Maxwell' },
  { text: 'A leader is one who knows the way, goes the way, and shows the way.', author: 'John C. Maxwell' },
  { text: 'Small disciplines repeated with consistency lead to great achievements.', author: 'John C. Maxwell' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'Believe you can and you are halfway there.', author: 'Theodore Roosevelt' },
  { text: 'Far and away the best prize that life offers is the chance to work hard at work worth doing.', author: 'Theodore Roosevelt' },
  { text: 'Opportunity is missed by most people because it is dressed in overalls and looks like work.', author: 'Thomas Edison' },
  { text: 'The difference between ordinary and extraordinary is that little extra.', author: 'Jimmy Johnson' },
  { text: 'Success usually comes to those who are too busy to be looking for it.', author: 'Henry David Thoreau' },
  { text: 'Never mistake motion for action.', author: 'Ernest Hemingway' },
  { text: 'The man who moves a mountain begins by carrying away small stones.', author: 'Confucius' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'Wherever you go, go with all your heart.', author: 'Confucius' },
  { text: 'Setting goals is the first step in turning the invisible into the visible.', author: 'Tony Robbins' },
  { text: 'The only limit to our realization of tomorrow is our doubts of today.', author: 'Franklin D. Roosevelt' },
  { text: 'Quality is remembered long after the price is forgotten.', author: 'Aldo Gucci' },
  { text: 'If you are going to achieve excellence in big things, you develop the habit in little matters.', author: 'Colin Powell' },
  { text: 'There are no traffic jams along the extra mile.', author: 'Roger Staubach' },
  { text: 'Done is better than perfect.', author: 'Sheryl Sandberg' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { text: 'The future depends on what you do today.', author: 'Mahatma Gandhi' },
  { text: 'Satisfaction lies in the effort, not in the attainment. Full effort is full victory.', author: 'Mahatma Gandhi' },
  { text: 'A river cuts through rock not because of its power but its persistence.', author: 'Jim Watkins' },
  { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
  { text: 'You miss one hundred percent of the shots you do not take.', author: 'Wayne Gretzky' },
  { text: 'Hard work beats talent when talent does not work hard.', author: 'Tim Notke' },
  { text: 'Take care of the minutes and the hours will take care of themselves.', author: 'Lord Chesterfield' },
  { text: 'Ideas are easy. Implementation is hard.', author: 'Guy Kawasaki' },
  { text: 'Make each day your masterpiece.', author: 'John Wooden' },
  { text: 'It is not the load that breaks you down, it is the way you carry it.', author: 'Lena Horne' },
  { text: 'The best preparation for tomorrow is doing your best today.', author: 'H. Jackson Brown Jr.' },
  { text: 'Trust is built with consistency.', author: 'Lincoln Chafee' },
  { text: 'Clarity precedes mastery.', author: 'Robin Sharma' },
  { text: 'What we do today, right now, will have an accumulated effect on all our tomorrows.', author: 'Alexandra Stoddard' },
];

/** Days since the Unix epoch (UTC) — stable for a whole calendar day. */
function epochDay(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000,
  );
}

/**
 * The quote for a given day — deterministic by date, identical for everyone,
 * changes at UTC midnight. `now` injectable for tests.
 */
export function quoteOfTheDay(now: Date = new Date()): Quote {
  return QUOTES[epochDay(now) % QUOTES.length];
}
