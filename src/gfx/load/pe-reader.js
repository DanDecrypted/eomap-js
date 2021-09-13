const ResourceType = {
  CURSOR: 1,
  BITMAP: 2,
  ICON: 3,
  MENU: 4,
  DIALOG: 5,
  STRING_TABLE: 6,
  FONT_DIRECTORY: 7,
  FONT: 8,
  ACCELERATOR: 9,
  UNFORMATTED: 10,
  MESSAGE_TABLE: 11,
  GROUP_CURSOR: 12,
  GROUP_ICON: 14,
  VERSION_INFORMATION: 16,
};

class ResourceDirectoryEntry {
  constructor(resourceType, subdirectoryOffset) {
    this.resourceType = resourceType;
    this.subdirectoryOffset = subdirectoryOffset;
  }
}

class ResourceDataEntry {
  constructor(offset, size, codePage, unused) {
    this.offset = offset;
    this.size = size;
    this.codePage = codePage;
    this.unused = unused;
  }
}

class ResourceInfo {
  constructor(start, size, width, height) {
    this.start = start;
    this.size = size;
    this.width = width;
    this.height = height;
  }
}

export class PEReader {
  constructor(buffer) {
    this.file = buffer;
    this.dataView = new DataView(buffer);
    this.position = 0;
    this.virtualAddress = 0;
    this.rootAddress = 0;

    this.bitmapDirectoryEntry = new ResourceDirectoryEntry();
    this.resourceInfo = new Map();

    this.readHeader();
    this.readBitmapTable();
  }

  seek(position) {
    this.position = position;
  }

  skip(offset) {
    this.position += offset;
  }

  readShort() {
    let result = this.dataView.getUint16(this.position, true);
    this.position += 2;
    return result;
  }

  readInt() {
    let result = this.dataView.getUint32(this.position, true);
    this.position += 4;
    return result;
  }

  readString(length) {
    let decoder = new TextDecoder("utf-8");
    let result = decoder.decode(
      new Uint8Array(this.file.slice(this.position, this.position + length))
    );
    this.position += length;
    return result;
  }

  readDirectoryEntryCount() {
    this.skip(0x0c);
    let namedEntries = this.readShort();
    let idEntries = this.readShort();
    return namedEntries + idEntries;
  }

  readResourceDirectoryEntry() {
    let resourceType = this.readInt();
    let subdirectoryOffset = this.readInt();
    return new ResourceDirectoryEntry(resourceType, subdirectoryOffset);
  }

  readResourceDataEntry() {
    let offset = this.readInt();
    let size = this.readInt();
    let codePage = this.readInt();
    let unused = this.readInt();
    return new ResourceDataEntry(offset, size, codePage, unused);
  }

  readHeader() {
    this.seek(0x3c);
    let peHeaderAddress = this.readShort();

    this.skip(peHeaderAddress - 0x3c - 0x02);
    let type = this.readString(4);
    if (type !== "PE\0\0") {
      throw new Error("Invalid PE file signature");
    }

    this.skip(0x02);
    let sections = this.readShort();

    this.skip(0x78 - 0x04 + 0x0c);
    this.virtualAddress = this.readInt();

    this.skip(0x6c + 0x08 + 0x04);

    for (let i = 0; i < sections; ++i) {
      let checkVirtualAddress = this.readInt();
      if (checkVirtualAddress == this.virtualAddress) {
        this.skip(0x04);
        this.rootAddress = this.readInt();
        break;
      }
      this.skip(0x24);
    }

    if (this.rootAddress == 0) {
      throw new Error("Invalid root address");
    }

    this.seek(this.rootAddress);
    let directoryEntryCount = this.readDirectoryEntryCount();

    for (let i = 0; i < directoryEntryCount; ++i) {
      let directoryEntry = this.readResourceDirectoryEntry();
      if (directoryEntry.resourceType === ResourceType.BITMAP) {
        this.bitmapDirectoryEntry = directoryEntry;
        this.bitmapDirectoryEntry.subdirectoryOffset -= 0x80000000;
        return;
      }
    }

    throw new Error("Missing bitmap resource directory");
  }

  readBitmapTable() {
    this.seek(this.rootAddress + this.bitmapDirectoryEntry.subdirectoryOffset);

    let directoryEntryCount = this.readDirectoryEntryCount();
    let bitmapEntries = new Array();
    for (let i = 0; i < directoryEntryCount; ++i) {
      let entry = this.readResourceDirectoryEntry();
      if (entry.subdirectoryOffset > 0x80000000) {
        entry.subdirectoryOffset -= 0x80000000;
        bitmapEntries.push(entry);
      }
    }

    for (let entry of bitmapEntries) {
      this.seek(this.rootAddress + entry.subdirectoryOffset + 20);
      let entrySubdirectoryOffset = this.readInt();

      this.seek(this.rootAddress + entrySubdirectoryOffset);
      let dataEntry = this.readResourceDataEntry();
      let start = dataEntry.offset - this.virtualAddress + this.rootAddress;
      let size = dataEntry.size;

      this.seek(start + 4);
      let width = this.readInt();
      let height = this.readInt();

      this.resourceInfo.set(
        entry.resourceType,
        new ResourceInfo(start, size, width, height)
      );
    }
  }

  getResourceIDs() {
    return this.resourceInfo.keys();
  }

  getResourceInfo(resourceID) {
    let info = this.resourceInfo.get(resourceID);
    if (!info) {
      info = null;
    }
    return info;
  }

  readResource(info) {
    return this.file.slice(info.start, info.start + info.size);
  }
}
