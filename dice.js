import crypto from 'crypto';
import { Table } from 'console-table-printer';
import readline from 'readline/promises';

class Dice {
  constructor(faces) {
    this.faces = faces;
    this.name = faces.join(',');
  }

  roll(index) {
    return this.faces[index];
  }

  toString() {
    return `[${this.name}]`;
  }
}

class DiceParser {
  static parse(input) {
    if (input.length < 3) throw new Error('At least 3 dice required');
    
    const dice = input.map((str, i) => {
      if (!/^\d+(,\d+)*$/.test(str)) throw new Error(`Non-integer value in the dice configuration ${i+1}`);
      
      const faces = str.split(',').map(n => {
        if (!/^\d+$/.test(n)) throw new Error(`Invalid number in die ${i+1}: ${n}`);
        return parseInt(n, 10);
      });
      
      if (new Set(faces).size === 1) {
        throw new Error(`Die ${i+1} has all identical faces`);
      }
      return new Dice(faces);
    });

    const uniqueNames = new Set(dice.map(d => d.name));
    if (uniqueNames.size !== dice.length) {
      throw new Error('Duplicate dice configurations found');
    }

    return dice;
  }
}

class FairRandomGenerator {
  constructor(range) {
    this.range = range;
    this.key = crypto.randomBytes(32);
    this.computerValue = this.generateSecureNumber();
    this.hmac = this.calculateHmac();
  }

  generateSecureNumber() {
    const max = 2 ** 32 - (2 ** 32 % this.range);
    let random;
    do {
      random = crypto.randomBytes(4).readUInt32BE(0);
    } while (random >= max);
    return random % this.range;
  }

  calculateHmac() {
    return crypto.createHmac('sha3-256', this.key)
      .update(this.computerValue.toString())
      .digest('hex');
  }

  calculateResult(userValue) {
    return (this.computerValue + userValue) % this.range;
  }
}

class ProbabilityCalculator {
  static calculate(dice) {
    const matrix = {};
    const diceNames = dice.map(d => d.name);
    
    diceNames.forEach(name => {
      matrix[name] = {};
      diceNames.forEach(colName => {
        matrix[name][colName] = (name === colName) ? '-' :
          this.calculateProbability(
            dice.find(d => d.name === name),
            dice.find(d => d.name === colName)
          ).toFixed(4);
      });
    });
    
    return { matrix, diceNames };
  }

  static calculateProbability(a, b) {
    let wins = 0;
    for (const fa of a.faces) {
      for (const fb of b.faces) {
        if (fa > fb) wins++;
      }
    }
    return wins / (a.faces.length * b.faces.length);
  }
}

class Game {
  constructor(dice, rl) {
    this.dice = dice;
    this.rl = rl;
    this.playerDie = null;
    this.computerDie = null;
  }

  async showHelp() {
    const { matrix, diceNames } = ProbabilityCalculator.calculate(this.dice);
    const table = new Table({
      columns: [{ name: 'Dice', alignment: 'left' }, ...diceNames.map(name => ({ name }))]
    });

    diceNames.forEach(rowName => {
      const rowData = { Dice: rowName };
      diceNames.forEach(colName => {
        rowData[colName] = matrix[rowName][colName];
      });
      table.addRow(rowData);
    });

    console.log('\n=== Probability Table ===');
    table.printTable();
    console.log('\nKey:');
    console.log('- Each cell shows probability of ROW dice beating COLUMN dice');
    console.log('- "-" indicates identical dice comparison\n');
  }

  async prompt(options, context) {
    while (true) {
      const input = (await this.rl.question('Your selection: '))
        .trim()
        .toUpperCase();

      if (input === '?') {
        await this.showHelp();
        continue;
      }
      
      if (input === 'X') {
        const confirm = await this.rl.question('Are you sure you want to exit? (y/n): ');
        if (confirm.toLowerCase() === 'y') {
          console.log('\nThanks for playing! Goodbye!');
          this.rl.close();
          process.exit(0);
        }
        continue;
      }

      if (options.includes(input)) {
        return input;
      }

      console.log(`\nInvalid input! Valid options: ${options.join(', ')}`);
      console.log(context);
    }
  }

  async fairSelection(range, context) {
    const gen = new FairRandomGenerator(range);
    console.log(`\n${context}`);
    console.log(`HMAC: ${gen.hmac}`);
    
    const options = Array.from({length: range}, (_, i) => i.toString());
    const menu = [
      `Valid numbers: 0-${range - 1}`,
      'X - Exit game',
      '? - Show help'
    ].join('\n');
    
    const userChoice = await this.prompt(
      [...options, 'X', '?'],
      menu
    );
    
    const result = gen.calculateResult(parseInt(userChoice));
    console.log(`\nFair roll result: ${result}`);
    console.log(`Verification key: ${gen.key.toString('hex')}`);
    return result;
  }

  async selectFirstPlayer() {
    console.log('\n=== Determine First Player ===');
    console.log('I generated a secret number (0 or 1)');
    const computerFirst = await this.fairSelection(2, 'Guess my number (0/1):');
    console.log(computerFirst === 1 ? '\nComputer goes first!' : '\nYou go first!');
    return computerFirst === 1;
  }

  async selectDie(availableDice, promptText) {
    console.log(`\n${promptText}`);
    availableDice.forEach((die, index) => 
      console.log(`${index} - ${die}`));
    
    const options = availableDice.map((_, i) => i.toString());
    const choice = await this.prompt(
      [...options, 'X', '?'],
      `Choose (0-${availableDice.length - 1}) | X - Exit | ? - Help`
    );
    
    return availableDice[parseInt(choice)];
  }

  async playRound(die, playerType) {
    console.log(`\n=== ${playerType} Roll ===`);
    const resultIndex = await this.fairSelection(
      die.faces.length,
      `Rolling ${die} - Select your modifier (0-${die.faces.length - 1}):`
    );
    return die.roll(resultIndex);
  }

  async run() {
    try {
      console.log('\n=== Non-Transitive Dice Game ===');
      console.log(`Loaded ${this.dice.length} dice:`);
      this.dice.forEach((die, i) => console.log(`Die ${i}: ${die}`));

      const computerFirst = await this.selectFirstPlayer();

      if (computerFirst) {
        this.computerDie = this.dice[Math.floor(Math.random() * this.dice.length)];
        console.log(`\nComputer chose: ${this.computerDie}`);
        this.playerDie = await this.selectDie(
          this.dice.filter(d => d !== this.computerDie),
          'Available dice:'
        );
      } else {
        this.playerDie = await this.selectDie(
          this.dice,
          'Choose your die:'
        );
        this.computerDie = this.dice.find(d => d !== this.playerDie);
        console.log(`\nComputer chose: ${this.computerDie}`);
      }

      const computerRoll = await this.playRound(this.computerDie, 'Computer');
      const playerRoll = await this.playRound(this.playerDie, 'Player');

      console.log('\n=== Final Results ===');
      console.log(`Computer's ${this.computerDie} rolled: ${computerRoll}`);
      console.log(`Your ${this.playerDie} rolled: ${playerRoll}`);

      if (playerRoll > computerRoll) {
        console.log('\n You win!');
      } else if (playerRoll < computerRoll) {
        console.log('\n Computer wins!');
      } else {
        console.log('\n It\'s a tie!');
      }

    } catch (error) {
      console.error(`\n Error: ${error.message}`);
    } finally {
      this.rl.close();
    }
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

try {
  const diceArgs = process.argv.slice(2);
  if (!diceArgs.length) {
    throw new Error('No dice provided\nUsage: node game.js DIE1 DIE2 DIE3...\nExample: node game.js 1,2,3 4,5,6 7,8,9');
  }
  
  const dice = DiceParser.parse(diceArgs);
  new Game(dice, rl).run();
} catch (error) {
  console.error(` Error: ${error.message}`);
  rl.close();
  process.exit(1);
}
