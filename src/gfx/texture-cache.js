import ShelfPack from "@mapbox/shelf-pack";
import { GFXProcessor } from "./gfx-processor";
import { DrawableMultiTexture } from "./drawable-multi-texture";

class TextureCacheEntry {
  constructor(data, page, bin, pixels) {
    this.data = data;
    this.page = page;
    this.bin = bin;
    this.pixels = pixels;
    this.refCount = 0;
  }

  incRef() {
    ++this.refCount;
  }

  decRef() {
    if (this.refCount === 0) {
      throw new Error("Negative asset entry refCount");
    }

    --this.refCount;
  }
}

class TextureCachePage {
  constructor(texturePage) {
    this.texturePage = texturePage;
    this.shelfPacker = new ShelfPack(texturePage.width, texturePage.height);
  }

  get empty() {
    return this.shelfPacker.bins[1] === undefined;
  }
}

export class TextureCache {
  constructor(scene, gfxLoader, width, height) {
    this.scene = scene;
    this.gfxLoader = gfxLoader;
    this.identifier = Phaser.Utils.String.UUID();
    this.pages = [];
    this.assets = new Map();
    this.pending = [];
    this.gfxProcessor = new GFXProcessor(scene, this.identifier);

    this.multiTexture = new DrawableMultiTexture(
      this.scene.textures,
      this.identifier,
      width,
      height
    );

    let firstPage = new TextureCachePage(this.multiTexture.pages[0]);
    this.pages.push(firstPage);
  }

  makeAssetKey(fileID, resourceID) {
    return fileID + "." + resourceID;
  }

  get(fileID, resourceID) {
    let asset = this.assets.get(this.makeAssetKey(fileID, resourceID));
    if (!asset) {
      asset = this.add(fileID, resourceID);
    }
    return asset;
  }

  add(fileID, resourceID) {
    let cacheEntry = null;

    let info = this.gfxLoader.info(fileID, resourceID);
    if (!info) {
      return cacheEntry;
    }

    for (let i = 0; i < this.pages.length; ++i) {
      cacheEntry = this.addToPage(
        i,
        fileID,
        resourceID,
        info.width,
        info.height
      );

      if (cacheEntry) {
        this.assets.set(this.makeAssetKey(fileID, resourceID), cacheEntry);
        break;
      }

      if (this.pages[i].empty) {
        throw new Error(
          `Failed to cache resource ${resourceID} from file ${fileID}`
        );
      }
    }

    if (!cacheEntry) {
      this.handleOutOfSpace();
      return this.add(fileID, resourceID);
    }

    return cacheEntry;
  }

  handleOutOfSpace() {
    this.addPage();
  }

  addPage() {
    let texturePage = this.multiTexture.addPage();
    let newPage = new TextureCachePage(texturePage);

    this.pages.push(newPage);
  }

  addToPage(pageIndex, fileID, resourceID, width, height) {
    let page = this.pages[pageIndex];
    let bin = page.shelfPacker.packOne(width, height);

    if (!bin) {
      return null;
    }

    let cacheFrameKey = fileID + "." + resourceID;
    this.multiTexture.add(
      cacheFrameKey,
      pageIndex,
      bin.x,
      bin.y,
      width,
      height
    );

    let assetData = this.gfxProcessor.processAssetData(
      fileID,
      resourceID,
      this.multiTexture.key,
      cacheFrameKey
    );

    let asset = new TextureCacheEntry(assetData, page, bin);
    this.pending.push(asset);

    return asset;
  }

  loadAsset(asset) {
    this.gfxLoader
      .loadResource(asset.data.fileID, asset.data.resourceID)
      .then((pixels) => {
        let page = asset.page.texturePage;
        let x = asset.bin.x;
        let y = asset.bin.y;
        page.draw(pixels, x, y);
      });
  }

  update() {
    let start = performance.now();
    let elapsed;
    let loaded = 0;
    let loadTime = Math.min(3, 1000 / this.scene.game.loop.actualFps / 2);

    this.pending.sort((a, b) => b.refCount - a.refCount);

    for (let asset of this.pending) {
      this.loadAsset(asset);
      ++loaded;
      elapsed = performance.now() - start;
      if (elapsed > loadTime) {
        break;
      }
    }

    this.pending.splice(0, loaded);
    if (loaded > 0) {
      console.log(`Sent ${loaded} assets to the worker in ${elapsed}ms`);
    }
  }
}

export class EvictingTextureCache extends TextureCache {
  constructor(scene, gfxLoader, width, height) {
    super(scene, gfxLoader, width, height);
    this.canEvict = true;
  }

  add(fileID, resourceID) {
    let asset = super.add(fileID, resourceID);
    this.canEvict = true;
    return asset;
  }

  handleOutOfSpace() {
    if (this.canEvict) {
      this.evict();
    } else {
      this.addPage();
    }
  }

  evict() {
    for (let [key, value] of this.assets.entries()) {
      if (value.refCount === 0) {
        this.evictAsset(key);
      }
    }
    this.canEvict = false;
  }

  evictAsset(assetKey) {
    let asset = this.assets.get(assetKey);
    let data = asset.data;
    let texture = this.scene.textures.get(data.textureKey);

    let removeFromTexture = (frame) => {
      delete texture.frames[frame.name];
      texture.frameTotal--;
      frame.destroy();
    };

    removeFromTexture(asset.data.textureFrame);

    if (data.animation) {
      for (let animFrame of data.animation.frames) {
        removeFromTexture(animFrame.frame);
      }
      data.animation.destroy();
    }

    this.assets.delete(assetKey);
  }
}
