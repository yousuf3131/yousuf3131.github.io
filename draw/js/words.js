// Word bank for Drawing Duel, organized by category.

const WORDS = {
    animals: [
        'cat', 'dog', 'elephant', 'giraffe', 'penguin', 'dolphin', 'snake', 'butterfly',
        'spider', 'octopus', 'kangaroo', 'parrot', 'shark', 'turtle', 'monkey', 'bear',
        'rabbit', 'horse', 'whale', 'frog', 'lion', 'chicken', 'bee', 'owl', 'crab',
        'snail', 'bat', 'duck', 'pig', 'zebra', 'koala', 'flamingo', 'jellyfish',
    ],
    food: [
        'pizza', 'burger', 'ice cream', 'banana', 'cake', 'sushi', 'taco', 'donut',
        'apple', 'watermelon', 'hot dog', 'popcorn', 'sandwich', 'cookie', 'cupcake',
        'pancake', 'fries', 'egg', 'cheese', 'grapes', 'carrot', 'pie', 'bread',
        'chocolate', 'lollipop', 'pineapple', 'mushroom', 'corn', 'broccoli', 'cherry',
    ],
    places: [
        'beach', 'castle', 'volcano', 'hospital', 'school', 'library', 'museum',
        'airport', 'island', 'farm', 'church', 'prison', 'zoo', 'playground',
        'mountain', 'desert', 'forest', 'cave', 'lighthouse', 'bridge', 'pyramid',
        'igloo', 'restaurant', 'stadium', 'circus', 'waterfall', 'swamp',
    ],
    objects: [
        'umbrella', 'guitar', 'clock', 'lamp', 'scissors', 'telescope', 'camera',
        'skateboard', 'ladder', 'key', 'candle', 'trophy', 'sword', 'balloon',
        'anchor', 'diamond', 'crown', 'drum', 'hammer', 'magnet', 'mirror',
        'rocket', 'satellite', 'parachute', 'compass', 'binoculars', 'wheelchair',
        'headphones', 'backpack', 'envelope', 'microphone', 'paintbrush',
    ],
    actions: [
        'swimming', 'sleeping', 'dancing', 'cooking', 'fishing', 'running',
        'singing', 'surfing', 'skiing', 'climbing', 'reading', 'painting',
        'skydiving', 'juggling', 'sneezing', 'crying', 'laughing', 'fighting',
        'flying', 'digging', 'rowing', 'bowling', 'boxing', 'yoga', 'handstand',
    ],
    things: [
        'rainbow', 'tornado', 'lightning', 'sunrise', 'campfire', 'snowman',
        'treasure map', 'robot', 'alien', 'ghost', 'pirate', 'ninja', 'mermaid',
        'dragon', 'unicorn', 'wizard', 'vampire', 'zombie', 'angel', 'astronaut',
        'superhero', 'scarecrow', 'skeleton', 'tooth fairy', 'werewolf',
    ],
};

const ALL = Object.values(WORDS).flat();

export function getRandomWords(n = 3) {
    const pool = [...ALL];
    const result = [];
    for (let i = 0; i < n && pool.length; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        result.push(pool.splice(idx, 1)[0]);
    }
    return result;
}
