import { Injectable } from '@angular/core';

import { BehaviorSubject, combineLatest } from 'rxjs';
import { withLatestFrom } from 'rxjs/operators';

import * as PIXI from 'pixi.js';

import { CashBalanceService } from '../cash-balance/cash-balance.service';
import { ResultService } from '../result/result.service';
import {
  MAX_REELS,
  REEL_WIDTH,
  SLOT_SYMBOL_NAMES_TEXTURES_MAP,
  SPIN_DELAY_PER_REEL,
  SPIN_TIME,
  STYLE,
  SYMBOL_SIZE
} from '../shared/constants';
import { FixerSettings, Reel, Result } from '../shared/models';
import { TweeningService } from '../tweening/tweening.service';
import { FixerService } from '../fixer/fixer.service';

@Injectable({
  providedIn: 'root'
})
export class PlayGameService {
  private reels: Reel[] = [];
  private bottomButton = new PIXI.Graphics();
  private slotTextures = Array.from(SLOT_SYMBOL_NAMES_TEXTURES_MAP.values()).map((i) =>
    PIXI.Texture.from(i)
  );
  private isLocked$$ = new BehaviorSubject<boolean>(false);
  private isGameInProgress$$ = new BehaviorSubject(false);
  private fixedSettings: FixerSettings | null = null;

  constructor(
    private tweeningService: TweeningService,
    private resultService: ResultService,
    private cashBalance: CashBalanceService,
    private fixer: FixerService
  ) {
    this.cashBalance.isBroke$
      .pipe(withLatestFrom(this.isLocked$$))
      .subscribe(([isBroke, isLocked]) => {
        if (isLocked && !isBroke) {
          this.isLocked$$.next(false);
        } else if (isBroke) {
          this.isLocked$$.next(true);
        }
      });

    this.isLocked$$.subscribe((i) => {
      if (!i) {
        (this.bottomButton as any).addListener('pointerdown', this.startPlay);
      } else {
        (this.bottomButton as any).removeListener('pointerdown', this.startPlay);
      }
    });

    combineLatest([this.isGameInProgress$$, this.fixer.fixerSettings$]).subscribe(
      ([isInProgress, settings]) => {
        if (!isInProgress) {
          this.fixedSettings = settings;
        }
      }
    );
  }

  public loadAssets(app: PIXI.Application): () => void {
    const reelContainer = new PIXI.Container();

    for (let i = 0; i < MAX_REELS; i++) {
      const rc = new PIXI.Container();
      rc.x = i * REEL_WIDTH;
      reelContainer.addChild(rc);

      const reel: Reel = {
        container: rc,
        symbols: [],
        position: 0,
        previousPosition: 0,
        blur: new PIXI.filters.BlurFilter()
      };

      reel.blur.blurX = 0;
      reel.blur.blurY = 0;
      rc.filters = [reel.blur];
      this.getReelSprites(reel, rc);
      this.reels.push(reel);
    }
    app.stage.addChild(reelContainer);

    const margin = (app.screen.height - SYMBOL_SIZE * 3) / 2;
    reelContainer.y = margin;
    reelContainer.x = Math.round(app.screen.width - REEL_WIDTH * 3);
    const top = new PIXI.Graphics();
    top.beginFill(0, 1);
    top.drawRect(0, 0, app.screen.width, margin);
    app.stage.addChild(top);
    this.bottomButton.beginFill(0, 1);
    this.bottomButton.drawRect(0, SYMBOL_SIZE * 3 + margin, app.screen.width, margin);

    const playText = new PIXI.Text('SPIN 2 WIN!', STYLE);
    playText.x = Math.round((this.bottomButton.width - playText.width) / 2);
    playText.y = app.screen.height - margin + Math.round(margin - playText.height);
    this.bottomButton.addChild(playText);

    app.stage.addChild(this.bottomButton);

    this.bottomButton.interactive = true;
    this.bottomButton.buttonMode = true;

    return () => this.updateReelsOnSpin();
  }

  private getReelSprites(reel: Reel, container: PIXI.Container): void {
    this.slotTextures.forEach((_, i) => {
      const symbol = new PIXI.Sprite(this.slotTextures[this.getRandomTextureIndex]);

      symbol.y = i * SYMBOL_SIZE;
      symbol.scale.x = symbol.scale.y = Math.min(
        SYMBOL_SIZE / symbol.width,
        SYMBOL_SIZE / symbol.height
      );
      symbol.x = Math.round((SYMBOL_SIZE - symbol.width) / 2);
      reel.symbols.push(symbol);
      container.addChild(symbol);
    });
  }

  private startPlay = () => {
    if (this.isGameInProgress$$.value) {
      return;
    }

    const backout = (amount: number) => (t: number) =>
      --t * t * ((amount + 1) * t + amount) + 1;

    this.isGameInProgress$$.next(true);
    this.cashBalance.decreaseCash();

    this.reels.forEach((r, i) => {
      const target = r.position + 10 + i * 5;
      const time = SPIN_TIME + i * SPIN_DELAY_PER_REEL;

      this.tweeningService.tweenTo(
        r,
        'position',
        target,
        time,
        backout(0.5),
        null,
        i === this.reels.length - 1 ? () => this.handleCompleteGame() : null
      );
    });
  };

  private handleCompleteGame(): void {
    const result: Result = [[], [], []];
    this.isGameInProgress$$.next(false);
    /** Yep, that's a crutch :) */
    setTimeout(() => {
      this.reels.forEach(({ symbols }) => {
        symbols.forEach((s) => {
          const path = s._texture.textureCacheIds[0];
          const index = Math.floor(s.transform.position._y / SYMBOL_SIZE);
          if (index >= 0 && index <= 2) {
            result[index].push(path);
          }
        });
      });
      this.resultService.newResult = result;
    });
  }

  private updateReelsOnSpin(): void {
    this.reels.forEach((reel, reelIndex) => {
      reel.blur.blurY = (reel.position - reel.previousPosition) * 8;
      reel.previousPosition = reel.position;
      this.updateSpinningReelSprites(reel, reelIndex);
    });
  }

  private updateSpinningReelSprites(reel: Reel, reelIndex: number): void {
    reel.symbols.forEach((sprite, spriteIndex) => {
      const previousY = sprite.y;
      sprite.y =
        ((reel.position + spriteIndex) % reel.symbols.length) * SYMBOL_SIZE - SYMBOL_SIZE;

      const setting = this.getFixedSpriteSetting(reelIndex, spriteIndex - 1);

      if (setting && setting.spriteIndex !== null) {
        const newSpriteTexture = this.slotTextures[setting.spriteIndex];
        sprite.texture = newSpriteTexture;
        sprite.scale.x = sprite.scale.y = Math.min(
          SYMBOL_SIZE / sprite.texture.width,
          SYMBOL_SIZE / sprite.texture.height
        );
        sprite.x = Math.round((SYMBOL_SIZE - sprite.width) / 2);
      } else if (sprite.y < 0 && previousY > SYMBOL_SIZE) {
        const newSpriteTexture = this.slotTextures[this.getRandomTextureIndex];
        sprite.texture = newSpriteTexture;
        sprite.scale.x = sprite.scale.y = Math.min(
          SYMBOL_SIZE / sprite.texture.width,
          SYMBOL_SIZE / sprite.texture.height
        );
        sprite.x = Math.round((SYMBOL_SIZE - sprite.width) / 2);
      }
    });
  }

  private getFixedSpriteSetting(reelIndex: number, spriteIndex: number) {
    return this.fixedSettings?.find(
      (i) => i.reelIndex === reelIndex && i.row === spriteIndex
    );
  }

  private get getRandomTextureIndex(): number {
    return Math.floor(Math.random() * this.slotTextures.length);
  }
}
