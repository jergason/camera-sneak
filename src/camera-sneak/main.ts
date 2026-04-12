import Phaser from 'phaser';
import { WIDTH, HEIGHT } from './constants';
import { GameScene } from './GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#111111',
  scene: [GameScene],
  input: { activePointers: 3 },
  physics: { default: 'arcade' },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);
