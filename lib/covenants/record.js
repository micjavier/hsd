'use strict';

const assert = require('assert');
const bns = require('bns');
const {onion, IP} = require('binet');
const {base58} = require('bstring');
const compress = require('./compress');
const Address = require('../primitives/address');

const {
  wire,
  util
} = bns;

const {
  Message,
  Record,
  RecordData,
  ARecord,
  AAAARecord,
  NSRecord,
  MXRecord,
  SOARecord,
  CNAMERecord,
  DNAMERecord,
  SRVRecord,
  TXTRecord,
  LOCRecord,
  DSRecord,
  TLSARecord,
  SSHFPRecord,
  OPENPGPKEYRecord,
  types
} = wire;

const {
  Compressor,
  Decompressor,
  ipSize,
  ipWrite,
  ipRead
} = compress;

/*
 * Constants
 */

const DUMMY = Buffer.alloc(0);

const ICANN = 'i';
const HSK = 'h';
const ICANNP = `.${ICANN}`;
const ICANNS = `${ICANN}.`;
const HSKP = `.${HSK}`;
const HSKS = `${HSK}.`;

const rtypes = {
  INET4: 1, // A
  INET6: 2, // AAAA
  ONION: 3, // TXT (appended to A/AAA responses)
  ONIONNG: 5, // TXT (appended to A/AAA responses)
  INAME: 6, // N/A
  HNAME: 7, // N/A

  CANONICAL: 8, // CNAME
  DELEGATE: 9, // DNAME
  NS: 10, // NS
  SERVICE: 11, // SRV
  URL: 12, // TXT
  EMAIL: 13, // TXT
  TEXT: 14, // TXT
  LOCATION: 15, // LOC
  MAGNET: 16, // TXT
  DS: 17, // DS
  TLS: 18, // TLSA
  SSH: 19, // SSHFP
  PGP: 20, // OPENPGPKEY (XXX)
  ADDR: 21 // TXT
};

class Extra extends RecordData {
  constructor() {
    super();
    this.type = 0;
    this.data = DUMMY;
  }

  compress() {
  }

  getSize(c) {
    return 2 + this.data.length;
  }

  toWriter(bw, c) {
    bw.writeU8(this.type);
    bw.writeU8(this.data.length);
    bw.writeBytes(this.data);
    return bw;
  }

  fromReader(br, d) {
    this.type = br.readU8();
    this.data = br.readBytes(br.readU8());
    return this;
  }

  toJSON() {
    return {
      type: this.type,
      data: this.data.toString('hex')
    };
  }

  fromJSON(json) {
    assert(json && typeof json === 'object');
    assert((json.type & 0xff) === json.type);
    assert(typeof json.data === 'string');
    assert((json.data >>> 1) <= 255);
    this.type = json.type;
    this.data = Buffer.from(json.data, 'hex');
    return this;
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

class Addr extends RecordData {
  constructor() {
    super();
    this.currency = '';
    this.address = '';
  }

  compress(c) {
    c.add(this.currency);
  }

  getSize(c) {
    if (this.currency === 'hsk') {
      const addr = Address.fromString(this.address);
      return 2 + addr.hash.length;
    }
    return c.size(this.currency) + 1 + this.address.length;
  }

  toWriter(bw, c) {
    if (this.currency === 'hsk') {
      const addr = Address.fromString(this.address);
      const mid = this.address[0] === 't' ? 0x40 : 0x00;
      bw.writeU8(0x80 | mid | addr.hash.length);
      bw.writeU8(addr.version);
      bw.writeBytes(addr.hash);
      return bw;
    }
    c.write(bw, this.currency);
    bw.writeU8(this.address.length);
    bw.writeString(this.address, 'ascii');
    return bw;
  }

  fromReader(br, d) {
    let len = br.readU8();

    const hsk = (len & 0x80) !== 0;
    const test = (len & 0x40) !== 0;

    if (hsk) {
      len &= 0x3f;

      const addr = new Address();
      addr.version = br.readU8();
      addr.hash = br.readBytes(len);

      this.currency = 'hsk';
      this.address = addr.toString(test ? 'testnet' : 'main');

      return this;
    }

    this.currency = d.read(br);
    this.address = br.readString('ascii', br.readU8());

    return this;
  }

  toString() {
    return `${this.currency}:${this.address}`;
  }

  fromString(str) {
    assert(typeof str === 'string');
    assert(str.length <= 512);
    const parts = str.split(':');
    assert(parts.length === 2);
    const [currency, address] = parts;
    assert(currency.length <= 0x3f);
    assert(address.length <= 255);
    this.currency = currency;
    this.address = address;
    return this;
  }

  static fromString(str) {
    return new this().fromString(str);
  }

  toJSON() {
    return this.toString();
  }

  fromJSON(json) {
    return this.fromString(json);
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

class SSH extends RecordData {
  constructor() {
    super();
    this.algorithm = 0;
    this.type = 0;
    this.fingerprint = DUMMY;
  }

  compress() {
  }

  getSize() {
    return 2 + 1 + this.fingerprint.length;
  }

  toWriter(bw) {
    bw.writeU8(this.algorithm);
    bw.writeU8(this.type);
    bw.writeU8(this.fingerprint.length);
    bw.writeBytes(this.fingerprint);
    return bw;
  }

  fromReader(br) {
    this.algorithm = br.readU8();
    this.type = br.readU8();
    this.fingerprint = br.readBytes(br.readU8());
    return this;
  }

  toJSON() {
    return {
      algorithm: this.algorithm,
      type: this.type,
      fingerprint: this.fingerprint.toString('hex')
    };
  }

  fromJSON(json) {
    assert(json && typeof json === 'object');
    assert((json.algorithm & 0xff) === json.algorithm);
    assert((json.type & 0xff) === json.type);
    assert(typeof json.fingerprint === 'string');
    assert((json.fingerprint >>> 1) <= 255);
    this.algorithm = json.algorithm;
    this.type = json.type;
    this.fingerprint = Buffer.from(json.fingerprint, 'hex');
    return this;
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

class PGP extends SSH {
  constructor() {
    super();
  }
}

class TLS extends RecordData {
  constructor() {
    super();
    this.protocol = '';
    this.port = 0;
    this.usage = 0;
    this.selector = 0;
    this.matchingType = 0;
    this.certificate = DUMMY;
  }

  compress(c) {
    c.add(this.protocol);
  }

  getSize(c) {
    return c.size(this.protocol) + 6 + this.certificate.length;
  }

  toWriter(bw, c) {
    c.write(bw, this.protocol);
    bw.writeU16(this.port);
    bw.writeU8(this.usage);
    bw.writeU8(this.selector);
    bw.writeU8(this.matchingType);
    bw.writeU8(this.certificate.length);
    bw.writeBytes(this.certificate);
    return bw;
  }

  fromReader(br, d) {
    this.protocol = d.read(br);
    this.port = br.readU16();
    this.usage = br.readU8();
    this.selector = br.readU8();
    this.matchingType = br.readU8();
    this.certificate = br.readBytes(br.readU8());
    return this;
  }

  toJSON() {
    return {
      protocol: this.protocol,
      port: this.port,
      usage: this.usage,
      selector: this.selector,
      matchingType: this.matchingType,
      certificate: this.certificate.toString('hex')
    };
  }

  fromJSON(json) {
    assert(json && typeof json === 'object');
    assert(typeof json.protocol === 'string');
    assert(json.protocol.length <= 255);
    assert((json.port & 0xffff) === json.port);
    assert((json.usage & 0xff) === json.usage);
    assert((json.selector & 0xff) === json.selector);
    assert((json.matchingType & 0xff) === json.matchingType);
    assert(typeof json.fingerprint === 'string');
    assert((json.fingerprint.length >>> 1) <= 255);
    this.protocol = json.protocol;
    this.port = json.port;
    this.usage = json.usage;
    this.selector = json.selector;
    this.matchingType = json.matchingType;
    this.certificate = Buffer.from(json.certificate, 'hex');
    return this;
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

class DS extends RecordData {
  constructor() {
    super();
    this.keyTag = 0;
    this.algorithm = 0;
    this.digestType = 0;
    this.digest = DUMMY;
  }

  compress() {
  }

  getSize() {
    return 4 + 1 + this.digest.length;
  }

  toWriter(bw) {
    bw.writeU16(this.keyTag);
    bw.writeU8(this.algorithm);
    bw.writeU8(this.digestType);
    bw.writeU8(this.digest.length);
    bw.writeBytes(this.digest);
    return bw;
  }

  fromReader(br) {
    this.keyTag = br.readU16BE();
    this.algorithm = br.readU8();
    this.digestType = br.readU8();
    this.digest = br.readBytes(br.readU8());
    return this;
  }

  toJSON() {
    return {
      keyTag: this.keyTag,
      algorithm: this.algorithm,
      digestType: this.digestType,
      digest: this.digest.toString('hex')
    };
  }

  fromJSON(json) {
    assert(json && typeof json === 'object');
    assert((json.keyTag & 0xffff) === json.keyTag);
    assert((json.algorithm & 0xff) === json.algorithm);
    assert((json.digestType & 0xff) === json.digestType);
    assert(typeof json.digest === 'string');
    assert((json.digest.length >>> 1) <= 255);
    this.keyTag = json.keyTag;
    this.algorithm = json.algorithm;
    this.digestType = json.digestType;
    this.digest = Buffer.from(json.digest, 'hex');
    return this;
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

class Magnet extends RecordData {
  constructor(nid, nin) {
    super();
    this.nid = nid || '';
    this.nin = nin || '';
  }

  compress(c) {
    c.add(this.nid);
  }

  getSize(c) {
    let size = 0;
    size += c.size(this.nid);
    size += 1 + (this.nin.length >>> 1);
    return size;
  }

  toWriter(bw, c) {
    c.write(bw, this.nid);
    bw.writeU8(this.nin.length >>> 1);
    bw.writeString(this.nin, 'hex');
    return bw;
  }

  fromReader(br, d) {
    this.nid = d.read(br);
    this.nin = br.readString('hex', br.readU8());
    return this;
  }

  toString() {
    return `magnet:?xt=urn:${this.nid}:${this.nin}`;
  }

  fromString(str) {
    assert(typeof str === 'string');
    assert(str.length <= 1024);

    const index = str.indexOf('xt=urn:');
    assert(index !== -1);
    assert(index !== 0);

    assert(str[index - 1] === '?' || str[index - 1] === '&');

    str = str.substring(index + 7);

    const parts = str.split(/[:&]/);
    assert(parts.length >= 2);

    const [nid, nin] = parts;

    assert(nid.length <= 255);
    assert(nin.length <= 255);

    this.nid = nid;
    this.nin = nin;

    return this;
  }

  static fromString(str) {
    return new this().fromString(str);
  }

  toJSON() {
    return this.toString();
  }

  fromJSON(json) {
    return this.fromString(json);
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

class Service extends RecordData {
  constructor() {
    super();
    this.service = '';
    this.protocol = '';
    this.priority = 0;
    this.weight = 0;
    this.target = new Target();
    this.port = 0;
  }

  isSMTP() {
    return this.service === 'smtp' && this.protocol === 'tcp';
  }

  compress(c) {
    c.add(this.service);
    c.add(this.protocol);
  }

  getSize(c) {
    let size = 0;
    size += c.size(this.service);
    size += c.size(this.protocol);
    size += 1;
    size += 1;
    size += this.target.getSize(c);
    size += 2;
    return size;
  }

  toWriter(bw, c) {
    c.write(bw, this.service);
    c.write(bw, this.protocol);
    bw.writeU8(this.priority);
    bw.writeU8(this.weight);
    this.target.toWriter(bw, c);
    bw.writeU16(this.port);
    return bw;
  }

  fromReader(br, d) {
    this.service = d.read(br);
    this.protocol = d.read(br);
    this.priority = br.readU8();
    this.weight = br.readU8();
    this.target.fromReader(br, d);
    this.port = br.readU16();
    return this;
  }

  toJSON() {
    return {
      service: this.service,
      protocol: this.protocol,
      priority: this.priority,
      weight: this.weight,
      target: this.target.toJSON(),
      port: this.port
    };
  }

  fromJSON(json) {
    assert(json && typeof json === 'object');

    if (json.service != null) {
      assert(typeof json.service === 'string');
      this.service = json.service;
    }

    if (json.protocol != null) {
      assert(typeof json.protocol === 'string');
      this.protocol = json.protocol;
    }

    if (json.priority != null) {
      assert((json.priority & 0xff) === json.priority);
      this.priority = json.priority;
    }

    if (json.weight != null) {
      assert((json.weight & 0xff) === json.weight);
      this.weight = json.weight;
    }

    if (json.target != null) {
      assert(typeof json.target === 'object');
      this.target.fromJSON(json.target);
    }

    if (json.port != null) {
      assert((json.port & 0xffff) === json.port);
      this.port = json.port;
    }

    return this;
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

class Location extends RecordData {
  constructor() {
    super();
    this.version = 0;
    this.size = 0;
    this.horizPre = 0;
    this.vertPre = 0;
    this.latitude = 0;
    this.longitude = 0;
    this.altitude = 0;
  }

  compress() {
  }

  getSize() {
    return 16;
  }

  toWriter(bw) {
    bw.writeU8(this.version);
    bw.writeU8(this.size);
    bw.writeU8(this.horizPre);
    bw.writeU8(this.vertPre);
    bw.writeU32(this.latitude);
    bw.writeU32(this.longitude);
    bw.writeU32(this.altitude);
    return bw;
  }

  fromReader(br) {
    this.version = br.readU8();
    this.size = br.readU8();
    this.horizPre = br.readU8();
    this.vertPre = br.readU8();
    this.latitude = br.readU32();
    this.longitude = br.readU32();
    this.altitude = br.readU32();
    return this;
  }

  toJSON() {
    return {
      version: this.version,
      size: this.size,
      horizPre: this.horizPre,
      vertPre: this.vertPre,
      latitude: this.latitude,
      longitude: this.longitude,
      altitude: this.altitude
    };
  }

  fromJSON(json) {
    assert(json && typeof json === 'object');

    if (json.version != null) {
      assert((json.version & 0xff) === json.version);
      this.version = json.version;
    }

    if (json.size != null) {
      assert((json.size & 0xff) === json.size);
      this.size = json.size;
    }

    if (json.horizPre != null) {
      assert((json.horizPre & 0xff) === json.horizPre);
      this.horizPre = json.horizPre;
    }

    if (json.vertPre != null) {
      assert((json.vertPre & 0xff) === json.vertPre);
      this.vertPre = json.vertPre;
    }

    if (json.latitude != null) {
      assert((json.latitude >>> 0) === json.latitude);
      this.latitude = json.latitude;
    }

    if (json.longitude != null) {
      assert((json.longitude >>> 0) === json.longitude);
      this.longitude = json.longitude;
    }

    if (json.altitude != null) {
      assert((json.altitude >>> 0) === json.altitude);
      this.altitude = json.altitude;
    }

    return this;
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

function compressTarget(type, target, c) {
  switch (type) {
    case rtypes.INAME: {
      const name = target.slice(0, -ICANNP.length);
      c.add(name);
      break;
    }
    case rtypes.HNAME: {
      const name = target.slice(0, -HSKP.length);
      c.add(name);
      break;
    }
  }
}

function sizeTarget(type, target, c) {
  let size = 0;

  switch (type) {
    case rtypes.INET4:
      size += 4;
      break;
    case rtypes.INET6:
      size += ipSize(IP.decode(target));
      break;
    case rtypes.ONION:
      size += 10;
      break;
    case rtypes.ONIONNG:
      size += 33;
      break;
    case rtypes.INAME: {
      const name = target.slice(0, -ICANNP.length);
      size += c.size(name);
      break;
    }
    case rtypes.HNAME: {
      const name = target.slice(0, -HSKP.length);
      size += c.size(name);
      break;
    }
  }

  return size;
}

function writeTarget(type, target, bw, c) {
  switch (type) {
    case rtypes.INET4: {
      const ip = IP.decode(target);
      assert(ip.length === 4);
      bw.writeBytes(ip);
      break;
    }
    case rtypes.INET6: {
      const ip = IP.decode(target);
      assert(ip.length === 16);
      ipWrite(bw, ip);
      break;
    }
    case rtypes.ONION: {
      const on = onion.decode(target);
      bw.writeBytes(on);
      break;
    }
    case rtypes.ONIONNG: {
      const key = onion.decodeNG(target);
      bw.writeBytes(key);
      break;
    }
    case rtypes.INAME: {
      const name = target.slice(0, -ICANNP.length);
      c.write(bw, name);
      break;
    }
    case rtypes.HNAME: {
      const name = target.slice(0, -HSKP.length);
      c.write(bw, name);
      break;
    }
    default: {
      throw new Error('Unknown target type.');
    }
  }
  return bw;
}

function readTarget(type, br, d) {
  switch (type) {
    case rtypes.INET4:
      return IP.encode(br.readBytes(4));
    case rtypes.INET6:
      return IP.encode(ipRead(br));
    case rtypes.ONION:
      return onion.encode(br.readBytes(10));
    case rtypes.ONIONNG:
      return onion.encodeNG(br.readBytes(33));
    case rtypes.INAME:
      return d.read(br) + ICANNP;
    case rtypes.HNAME:
      return d.read(br) + HSKP;
    default:
      throw new Error('Unknown target type.');
  }
}

class Target extends RecordData {
  constructor(type, target) {
    super();
    this.type = rtypes.INET4;
    this.target = '0.0.0.0';
    this.from(type, target);
  }

  from(type, target) {
    if (typeof type === 'string')
      return this.fromString(type);

    if (type != null)
      this.type = type;

    if (target != null)
      this.target = target;

    return this;
  }

  static from(type, target) {
    return new this().from(type, target);
  }

  compress(c) {
    compressTarget(this.type, this.target, c);
  }

  toString() {
    return this.target;
  }

  fromString(str) {
    assert(typeof str === 'string');

    const st = IP.getStringType(str);

    switch (st) {
      case IP.types.INET4: {
        this.type = rtypes.INET4;
        this.target = IP.normalize(str);
        break;
      }
      case IP.types.INET6: {
        this.type = rtypes.INET6;
        this.target = IP.normalize(str);
        break;
      }
      case IP.types.ONION: {
        this.type = rtypes.ONION;
        this.target = str;
        break;
      }
      case IP.types.NAME: {
        assert(util.isName(str));

        if (onion.isNGString(str)) {
          this.type = rtypes.ONIONNG;
          this.target = str;
          break;
        }

        str = util.trimFQDN(str);

        if (str.endsWith(HSKP)) {
          this.type = rtypes.HNAME;
          this.target = str;
        } else {
          if (!str.endsWith(ICANNP))
            str += ICANNP;
          this.type = rtypes.INAME;
          this.target = str;
        }

        break;
      }
    }

    return this;
  }

  static fromString(str) {
    return new this().fromString(str);
  }

  toJSON() {
    return this.toString();
  }

  fromJSON(json) {
    return this.fromString(json);
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  isNull() {
    return this.type === rtypes.INET4 && this.target === '0.0.0.0';
  }

  toPointer(name) {
    assert(this.isINET());
    const ip = IP.decode(this.target);
    const hash = base58.encode(ip);
    return `_${hash}.${name}`;
  }

  isINET4() {
    return this.type === rtypes.INET4;
  }

  isINET6() {
    return this.type === rtypes.INET6;
  }

  isOnion() {
    return this.type === rtypes.ONION;
  }

  isOnionNG() {
    return this.type === rtypes.ONIONNG;
  }

  isHSK() {
    return this.type === rtypes.HNAME;
  }

  isICANN() {
    return this.type === rtypes.INAME;
  }

  isINET() {
    return this.type <= rtypes.INET6;
  }

  isName() {
    return this.type > rtypes.ONIONNG;
  }

  isTor() {
    return this.isOnion() || this.isOnionNG();
  }

  toDNS() {
    if (this.isHSK())
      return this.target + '.';

    if (this.isICANN())
      return this.target.slice(0, -ICANNP.length) + '.';

    return this.target;
  }

  getSize(c) {
    return 1 + sizeTarget(this.type, this.target, c);
  }

  toWriter(bw, c) {
    bw.writeU8(this.type);
    writeTarget(this.type, this.target, bw, c);
    return bw;
  }

  fromReader(br, d) {
    this.type = br.readU8();
    this.target = readTarget(this.type, br, d);
    return this;
  }

  inspect() {
    return this.toJSON();
  }
}

class HSKRecord extends RecordData {
  constructor() {
    super();
    this.version = 0;
    this.ttl = 0;
    this.hosts = [];
    this.canonical = null;
    this.delegate = null;
    this.ns = [];
    this.service = [];
    this.url = [];
    this.email = [];
    this.text = [];
    this.location = [];
    this.magnet = [];
    this.ds = [];
    this.tls = [];
    this.ssh = [];
    this.pgp = [];
    this.addr = [];
    this.extra = [];
  }

  compress() {
    const c = new Compressor();

    for (const host of this.hosts)
      host.compress(c);

    if (this.canonical)
      this.canonical.compress(c);

    if (this.delegate)
      this.delegate.compress(c);

    for (const ns of this.ns)
      ns.compress(c);

    for (const srv of this.service)
      srv.compress(c);

    for (const url of this.url)
      c.add(url);

    for (const email of this.email)
      c.add(email);

    for (const text of this.text)
      c.add(text);

    for (const loc of this.location)
      loc.compress(c);

    for (const urn of this.magnet)
      urn.compress(c);

    for (const ds of this.ds)
      ds.compress(c);

    for (const tls of this.tls)
      tls.compress(c);

    for (const ssh of this.ssh)
      ssh.compress(c);

    for (const pgp of this.pgp)
      pgp.compress(c);

    for (const addr of this.addr)
      addr.compress(c);

    for (const extra of this.extra)
      extra.compress(c);

    return c;
  }

  toRaw() {
    const c = this.compress();
    return super.toRaw(c);
  }

  getSize(c) {
    let size = 1 + 2;

    size += c.getSize();

    for (const host of this.hosts)
      size += host.getSize(c);

    if (this.canonical)
      size += 1 + this.canonical.getSize(c);

    if (this.delegate)
      size += 1 + this.delegate.getSize(c);

    for (const ns of this.ns)
      size += 1 + ns.getSize(c);

    for (const srv of this.service)
      size += 1 + srv.getSize(c);

    for (const url of this.url)
      size += 1 + c.size(url);

    for (const email of this.email)
      size += 1 + c.size(email);

    for (const text of this.text)
      size += 1 + c.size(text);

    for (const loc of this.location)
      size += 1 + loc.getSize(c);

    for (const urn of this.magnet)
      size += 1 + urn.getSize(c);

    for (const ds of this.ds)
      size += 1 + ds.getSize(c);

    for (const tls of this.tls)
      size += 1 + tls.getSize(c);

    for (const ssh of this.ssh)
      size += 1 + ssh.getSize(c);

    for (const pgp of this.pgp)
      size += 1 + pgp.getSize(c);

    for (const addr of this.addr)
      size += 1 + addr.getSize(c);

    for (const extra of this.extra)
      size += 1 + extra.getSize(c);

    return size;
  }

  toWriter(bw, c) {
    // Serialization version.
    bw.writeU8(this.version);

    // TTL has a granularity of 6
    // (about 1 minute per unit).
    bw.writeU16(this.ttl >>> 6);

    // Write the symbol table.
    c.toWriter(bw);

    for (const host of this.hosts)
      host.toWriter(bw, c);

    if (this.canonical) {
      bw.writeU8(rtypes.CANONICAL);
      this.canonical.toWriter(bw, c);
    }

    if (this.delegate) {
      bw.writeU8(rtypes.DELEGATE);
      this.delegate.toWriter(bw, c);
    }

    for (const ns of this.ns) {
      bw.writeU8(rtypes.NS);
      ns.toWriter(bw, c);
    }

    for (const srv of this.service) {
      bw.writeU8(rtypes.SERVICE);
      srv.toWriter(bw, c);
    }

    for (const url of this.url) {
      bw.writeU8(rtypes.URL);
      c.write(bw, url);
    }

    for (const email of this.email) {
      bw.writeU8(rtypes.EMAIL);
      c.write(bw, email);
    }

    for (const text of this.text) {
      bw.writeU8(rtypes.TEXT);
      c.write(bw, text);
    }

    for (const loc of this.location) {
      bw.writeU8(rtypes.LOCATION);
      loc.toWriter(bw, c);
    }

    for (const urn of this.magnet) {
      bw.writeU8(rtypes.MAGNET);
      urn.toWriter(bw, c);
    }

    for (const ds of this.ds) {
      bw.writeU8(rtypes.DS);
      ds.toWriter(bw, c);
    }

    for (const tls of this.tls) {
      bw.writeU8(rtypes.TLS);
      tls.toWriter(bw, c);
    }

    for (const ssh of this.ssh) {
      bw.writeU8(rtypes.SSH);
      ssh.toWriter(bw, c);
    }

    for (const pgp of this.pgp) {
      bw.writeU8(rtypes.PGP);
      pgp.toWriter(bw, c);
    }

    for (const addr of this.addr) {
      bw.writeU8(rtypes.ADDR);
      addr.toWriter(bw, c);
    }

    for (const extra of this.extra) {
      bw.writeU8(extra.type);
      extra.toWriter(bw, c);
    }

    return bw;
  }

  fromReader(br) {
    // Serialization version.
    const version = br.readU8();

    if (version !== 0)
      throw new Error(`Unknown serialization version: ${version}.`);

    // TTL has a granularity of 6
    // (about 1 minute per unit).
    this.ttl = br.readU16() << 6;

    // Read the symbol table.
    const d = Decompressor.fromReader(br);

    while (br.left()) {
      const type = br.readU8();
      switch (type) {
        case rtypes.INET4:
        case rtypes.INET6:
        case rtypes.ONION:
        case rtypes.ONIONNG: {
          const target = readTarget(type, br, d);
          this.hosts.push(new Target(type, target));
          break;
        }
        case rtypes.INAME:
        case rtypes.HNAME: {
          assert(!this.canonical);
          const target = readTarget(type, br, d);
          this.canonical = new Target(type, target);
          break;
        }
        case rtypes.CANONICAL:
          assert(!this.canonical);
          this.canonical = Target.fromReader(br, d);
          break;
        case rtypes.DELEGATE:
          assert(!this.delegate);
          this.delegate = Target.fromReader(br, d);
          break;
        case rtypes.NS:
          this.ns.push(Target.fromReader(br, d));
          break;
        case rtypes.SERVICE:
          this.service.push(Service.fromReader(br, d));
          break;
        case rtypes.URL:
          this.url.push(d.read(br));
          break;
        case rtypes.EMAIL:
          this.email.push(d.read(br));
          break;
        case rtypes.TEXT:
          this.text.push(d.read(br));
          break;
        case rtypes.LOCATION:
          this.location.push(Location.fromReader(br, d));
          break;
        case rtypes.MAGNET:
          this.magnet.push(Magnet.fromReader(br, d));
          break;
        case rtypes.DS:
          this.ds.push(DS.fromReader(br, d));
          break;
        case rtypes.TLS:
          this.tls.push(TLS.fromReader(br, d));
          break;
        case rtypes.SSH:
          this.ssh.push(SSH.fromReader(br, d));
          break;
        case rtypes.PGP:
          this.pgp.push(PGP.fromReader(br, d));
          break;
        case rtypes.ADDR:
          this.addr.push(Addr.fromReader(br, d));
          break;
        default:
          this.extra.push(Extra.fromReader(br, d));
          break;
      }
    }

    return this;
  }

  toA(name) {
    const answer = [];

    for (const host of this.hosts) {
      if (!host.isINET4())
        continue;

      const rr = new Record();
      rr.name = name;
      rr.ttl = this.ttl;
      rr.type = types.A;
      rr.data = new ARecord();
      rr.data.address = host.target;

      answer.push(rr);
    }

    if (this.hasTor())
      answer.push(this.toTorTXT(name));

    return answer;
  }

  toAAAA(name) {
    const answer = [];

    for (const host of this.hosts) {
      if (!host.isINET6())
        continue;

      const rr = new Record();
      rr.name = name;
      rr.ttl = this.ttl;
      rr.type = types.AAAA;
      rr.data = new AAAARecord();
      rr.data.address = host.target;

      answer.push(rr);
    }

    if (this.hasTor())
      answer.push(this.toTorTXT(name));

    return answer;
  }

  toCNAME(name) {
    if (!this.canonical)
      return [];

    assert(this.canonical.isName());
    const rr = new Record();
    rr.name = name;
    rr.ttl = this.ttl;
    rr.type = types.CNAME;
    rr.data = new CNAMERecord();
    rr.data.target = this.canonical.toDNS();

    return [rr];
  }

  toDNAME(name) {
    if (!this.delegate)
      return [];

    assert(this.delegate.isName());
    const rr = new Record();
    rr.name = name;
    rr.ttl = this.ttl;
    rr.type = types.DNAME;
    rr.data = new DNAMERecord();
    rr.data.target = this.delegate.toDNS();

    return [rr];
  }

  toNS(name, naked) {
    const authority = [];

    for (const ns of this.ns) {
      let nsname = null;

      if (ns.isName())
        nsname = ns.toDNS();
      else if (naked && ns.isINET())
        nsname = ns.toPointer(name);

      if (!nsname)
        continue;

      const rr = new Record();
      const rd = new NSRecord();
      rr.name = name;
      rr.ttl = this.ttl;
      rr.type = types.NS;
      rr.data = rd;
      rd.ns = nsname;

      authority.push(rr);
    }

    return authority;
  }

  toNSIP(name, naked) {
    if (!naked)
      return [];

    const additional = [];

    for (const ns of this.ns) {
      if (!ns.isINET())
        continue;

      const rr = new Record();
      rr.name = ns.toPointer(name);
      rr.ttl = this.ttl;

      if (ns.isINET4()) {
        rr.type = types.A;
        rr.data = new ARecord();
      } else {
        rr.type = types.AAAA;
        rr.data = new AAAARecord();
      }

      rr.data.address = ns.target;

      additional.push(rr);
    }

    return additional;
  }

  toSOA(name) {
    assert(util.isFQDN(name));

    const tld = util.from(name, -1);
    const rr = new Record();
    const rd = new SOARecord();

    rr.name = tld;
    rr.type = types.SOA;
    rr.ttl = this.ttl;
    rr.data = rd;

    rd.ns = tld;
    rd.mbox = tld;
    rd.serial = 0;
    rd.refresh = 1800;
    rd.retry = this.ttl;
    rd.expire = 604800;
    rd.minttl = 86400;

    const ns = this.toNS(tld);

    if (ns.length > 0)
      rd.ns = ns[0].data.ns;

    const mx = this.toMX(tld);

    if (mx.length > 0)
      rd.mbox = mx[0].data.mx;

    return [rr];
  }

  toMX(name, naked) {
    const answer = [];

    for (const srv of this.service) {
      if (!srv.isSMTP())
        continue;

      let mxname = null;

      if (srv.target.isName())
        mxname = srv.target.toDNS();
      else if (naked && srv.target.isINET())
        mxname = srv.target.toPointer(name);

      if (!mxname)
        continue;

      const rr = new Record();
      const rd = new MXRecord();

      rr.name = name;
      rr.type = types.MX;
      rr.ttl = this.ttl;
      rr.data = rd;

      rd.preference = srv.priority;
      rd.mx = mxname;

      answer.push(rr);
    }

    return answer;
  }

  toMXIP(name, naked) {
    return this.toSRVIP(name, naked, true);
  }

  toSRV(name, naked) {
    const answer = [];

    for (const srv of this.service) {
      let target = null;

      if (srv.target.isName())
        target = srv.target.toDNS();
      else if (naked && srv.target.isINET())
        target = srv.target.toPointer(name);

      if (!target)
        continue;

      const rr = new Record();
      const rd = new SRVRecord();

      rr.name = `_${srv.service}._${srv.protocol}.${name}`;
      rr.type = types.SRV;
      rr.ttl = this.ttl;
      rr.data = rd;

      rd.priority = srv.priority;
      rd.weight = srv.weight;
      rd.target = target;
      rd.port = srv.port;

      answer.push(rr);
    }

    return answer;
  }

  toSRVIP(name, naked, mx) {
    if (!naked)
      return [];

    const additional = [];

    for (const srv of this.service) {
      if (mx && !srv.isSMTP())
        continue;

      if (!srv.target.isINET())
        continue;

      const rr = new Record();
      rr.name = srv.target.toPointer(name);
      rr.ttl = this.ttl;

      if (srv.target.isINET4()) {
        rr.type = types.A;
        rr.data = new ARecord();
      } else {
        rr.type = types.AAAA;
        rr.data = new AAAARecord();
      }

      rr.data.address = srv.target.target;

      additional.push(rr);
    }

    return additional;
  }

  toLOC(name) {
    const answer = [];

    for (const loc of this.location) {
      const rr = new Record();
      const rd = new LOCRecord();

      rr.name = name;
      rr.type = types.LOC;
      rr.ttl = this.ttl;
      rr.data = rd;

      rd.version = loc.version;
      rd.size = loc.size;
      rd.horizPre = loc.horizPre;
      rd.vertPre = loc.vertPre;
      rd.latitude = loc.latitude;
      rd.longitude = loc.longitude;
      rd.altitude = loc.altitude;

      answer.push(rr);
    }

    return answer;
  }

  toDS(name) {
    const answer = [];

    for (const ds of this.ds) {
      const rr = new Record();
      const rd = new DSRecord();

      rr.name = name;
      rr.type = types.DS;
      rr.ttl = this.ttl;
      rr.data = rd;

      rd.keyTag = ds.keyTag;
      rd.algorithm = ds.algorithm;
      rd.digestType = ds.digestType;
      rd.digest = ds.digest;

      answer.push(rr);
    }

    return answer;
  }

  toTLSA(name) {
    const answer = [];

    for (const tls of this.tls) {
      const rr = new Record();
      const rd = new TLSARecord();

      rr.name = `_${tls.port}._${tls.protocol}.${name}`;
      rr.type = types.TLSA;
      rr.ttl = this.ttl;
      rr.data = rd;

      rd.usage = tls.usage;
      rd.selector = tls.selector;
      rd.matchingType = tls.matchingType;
      rd.certificate = tls.certificate;

      answer.push(rr);
    }

    return answer;
  }

  toSSHFP(name) {
    const answer = [];

    for (const ssh of this.ssh) {
      const rr = new Record();
      const rd = new SSHFPRecord();

      rr.name = name;
      rr.type = types.SSHFP;
      rr.ttl = this.ttl;
      rr.data = rd;

      rd.algorithm = ssh.algorithm;
      rd.type = ssh.type;
      rd.fingerprint = ssh.fingerprint;

      answer.push(rr);
    }

    return answer;
  }

  toOPENPGPKEY(name) {
    const answer = [];

    for (const pgp of this.pgp) {
      const rr = new Record();
      const rd = new OPENPGPKEYRecord();

      rr.name = name;
      rr.type = types.OPENPGPKEY;
      rr.ttl = this.ttl;
      rr.data = rd;

      // XXX
      rd.publicKey = pgp.toRaw();

      answer.push(rr);
    }

    return answer;
  }

  hasTor() {
    for (const host of this.hosts) {
      if (host.isTor())
        return true;
    }
    return false;
  }

  toTorTXT(name) {
    const rr = new Record();
    const rd = new TXTRecord();

    rr.name = name;
    rr.type = types.TXT;
    rr.ttl = this.ttl;
    rr.data = rd;

    rd.txt.push('hsk:tor');

    for (const host of this.hosts) {
      if (host.isTor())
        rd.txt.push(host.target);
    }

    return rr;
  }

  toURLTXT(name) {
    const rr = new Record();
    const rd = new TXTRecord();

    rr.name = name;
    rr.type = types.TXT;
    rr.ttl = this.ttl;
    rr.data = rd;

    rd.txt.push('hsk:url');

    for (const url of this.url)
      rd.txt.push(url);

    return rr;
  }

  toEmailTXT(name) {
    const rr = new Record();
    const rd = new TXTRecord();

    rr.name = name;
    rr.type = types.TXT;
    rr.ttl = this.ttl;
    rr.data = rd;

    rd.txt.push('hsk:email');

    for (const email of this.email)
      rd.txt.push(email);

    return rr;
  }

  toMagnetTXT(name) {
    const rr = new Record();
    const rd = new TXTRecord();

    rr.name = name;
    rr.type = types.TXT;
    rr.ttl = this.ttl;
    rr.data = rd;

    rd.txt.push('hsk:magnet');

    for (const urn of this.magnet)
      rd.txt.push(urn.toString());

    return rr;
  }

  toAddrTXT(name) {
    const rr = new Record();
    const rd = new TXTRecord();

    rr.name = name;
    rr.type = types.TXT;
    rr.ttl = this.ttl;
    rr.data = rd;

    rd.txt.push('hsk:addr');

    for (const addr of this.addr)
      rd.txt.push(addr.toString());

    return rr;
  }

  toTextTXT(name) {
    const rr = new Record();
    const rd = new TXTRecord();

    rr.name = name;
    rr.type = types.TXT;
    rr.ttl = this.ttl;
    rr.data = rd;

    for (const txt of this.text)
      rd.txt.push(txt);

    return rr;
  }

  toTXT(name) {
    const answer = [];

    if (this.text.length > 0)
      answer.push(this.toTextTXT(name));

    if (this.url.length > 0)
      answer.push(this.toURLTXT(name));

    if (this.email.length > 0)
      answer.push(this.toEmailTXT(name));

    if (this.magnet.length > 0)
      answer.push(this.toMagnetTXT(name));

    if (this.addr.length > 0)
      answer.push(this.toAddrTXT(name));

    return answer;
  }

  toDNS(name, type, naked) {
    // Our fake resolution.
    const res = new Message();

    res.qr = true;
    res.ad = true;

    assert(util.isFQDN(name));

    const labels = util.split(name);

    // XXX
    naked = true;

    // In the outer function call we forcibly changed
    // the resolvers question from google.com.hsk to
    // google.com (maybe add functionality elsewhere).
    // Say we're resolving google.com.hsk, we remove the .hsk,
    // use the root record's NS servers like so:
    // We take the first domain, and create a response like:
    // NS(com) -> gtld-servers.net
    // This works because we removed the .hsk, causing
    // our resolver to not hit us again.
    if (labels.length > 1) {
      const tld = util.from(name, labels, -1);

      if (this.ns.length > 0) {
        res.authority = this.toNS(tld, naked);
        res.additional = this.toNSIP(tld, naked);
      } else if (this.delegate) {
        // Should be in answer???
        res.answer = this.toDNAME(tld);
      } else {
        res.authority = this.toSOA(tld);
      }

      // Always push on DS records for a referral.
      for (const rr of this.toDS(tld))
        res.authority.push(rr);

      res.setEDNS0(4096, true);

      return res;
    }

    // Down here, we may just be resolving `com.`.
    // Use CNAME, A, etc records (_direct_ non-referral records).
    res.aa = true;

    // Authoritative response.
    switch (type) {
      case types.ANY:
        res.answer = this.toSOA(name);
        for (const rr of this.toNS(name, naked))
          res.answer.push(rr);
        res.additional = this.toNSIP(name, naked);
        break;
      case types.A:
        res.answer = this.toA(name);
        break;
      case types.AAAA:
        res.answer = this.toAAAA(name);
        break;
      case types.CNAME:
        res.answer = this.toCNAME(name);
        break;
      case types.DNAME:
        res.answer = this.toDNAME(name);
        break;
      case types.NS:
        res.answer = this.toNS(name, naked);
        res.additional = this.toNSIP(name, naked);
        break;
      case types.MX:
        res.answer = this.toMX(name, naked);
        res.additional = this.toMXIP(name, naked);
        break;
      case types.SRV:
        res.answer = this.toSRV(name, naked);
        res.additional = this.toSRVIP(name, naked);
        break;
      case types.TXT:
        res.answer = this.toTXT(name);
        break;
      case types.LOC:
        res.answer = this.toLOC(name);
        break;
      case types.DS:
        res.answer = this.toDS(name);
        break;
      case types.TLSA:
        res.answer = this.toTLSA(name);
        break;
      case types.OPENPGPKEY:
        res.answer = this.toOPENPGPKEY(name);
        break;
    }

    if (res.answer.length === 0 && res.authority.length === 0) {
      if (this.canonical) {
        res.answer = this.toCNAME(name);
        res.setEDNS0(4096, true);
        return res;
      }
    }

    if (res.answer.length === 0
        && res.authority.length === 0) {
      res.answer = this.toSOA(name);
    }

    res.setEDNS0(4096, true);

    return res;
  }

  toJSON(name) {
    const json = {
      version: this.version,
      name,
      ttl: this.ttl
    };

    if (this.hosts.length > 0) {
      json.hosts = [];
      for (const host of this.hosts)
        json.hosts.push(host.toJSON());
    }

    if (this.canonical)
      json.canonical = this.canonical.toJSON();

    if (this.delegate)
      json.delegate = this.delegate.toJSON();

    if (this.ns.length > 0) {
      json.ns = [];
      for (const ns of this.ns)
        json.ns.push(ns.toJSON());
    }

    if (this.service.length > 0) {
      json.service = [];
      for (const srv of this.service)
        json.service.push(srv.toJSON());
    }

    if (this.url.length > 0) {
      json.url = [];
      for (const url of this.url)
        json.url.push(url);
    }

    if (this.email.length > 0) {
      json.email = [];
      for (const email of this.email)
        json.email.push(email);
    }

    if (this.text.length > 0) {
      json.text = [];
      for (const txt of this.text)
        json.text.push(txt);
    }

    if (this.location.length > 0) {
      json.location = [];
      for (const loc of this.location)
        json.location.push(loc.toJSON());
    }

    if (this.magnet.length > 0) {
      json.magnet = [];
      for (const urn of this.magnet)
        json.magnet.push(urn.toJSON());
    }

    if (this.ds.length > 0) {
      json.ds = [];
      for (const ds of this.ds)
        json.ds.push(ds.toJSON());
    }

    if (this.tls.length > 0) {
      json.tls = [];
      for (const tls of this.tls)
        json.tls.push(tls.toJSON());
    }

    if (this.ssh.length > 0) {
      json.ssh = [];
      for (const ssh of this.ssh)
        json.ssh.push(ssh.toJSON());
    }

    if (this.pgp.length > 0) {
      json.pgp = [];
      for (const pgp of this.pgp)
        json.pgp.push(pgp.toJSON());
    }

    if (this.pgp.length > 0) {
      json.pgp = [];
      for (const pgp of this.pgp)
        json.pgp.push(pgp.toJSON());
    }

    if (this.addr.length > 0) {
      json.addr = [];
      for (const addr of this.addr)
        json.addr.push(addr.toJSON());
    }

    if (this.extra.length > 0) {
      json.extra = [];
      for (const extra of this.extra)
        json.extra.push(extra.toJSON());
    }

    return json;
  }

  fromJSON(json) {
    assert(json && typeof json === 'object');

    if (json.version != null) {
      assert(json.version === 0);
      this.version = json.version;
    }

    if (json.ttl != null) {
      assert((json.ttl >>> 0) === json.ttl);
      this.ttl = json.ttl;
    }

    if (json.hosts != null) {
      assert(Array.isArray(json.hosts));
      for (const host of json.hosts)
        this.hosts.push(Target.fromJSON(host));
    }

    if (json.canonical != null)
      this.canonical = Target.fromJSON(json.canonical);

    if (json.delegate != null)
      this.delegate = Target.fromJSON(json.delegate);

    if (json.ns != null) {
      assert(Array.isArray(json.ns));
      for (const ns of json.ns)
        this.ns.push(Target.fromJSON(ns));
    }

    if (json.service != null) {
      assert(Array.isArray(json.service));
      for (const srv of json.service)
        this.service.push(Service.fromJSON(srv));
    }

    if (json.url != null) {
      assert(Array.isArray(json.url));
      for (const url of json.url) {
        assert(typeof url === 'string');
        assert(url.length <= 255);
        this.url.push(url);
      }
    }

    if (json.email != null) {
      assert(Array.isArray(json.email));
      for (const email of json.email) {
        assert(typeof email === 'string');
        assert(email.length <= 255);
        this.email.push(email);
      }
    }

    if (json.text != null) {
      assert(Array.isArray(json.text));
      for (const txt of json.text) {
        assert(typeof txt === 'string');
        assert(txt.length <= 255);
        this.text.push(txt);
      }
    }

    if (json.location != null) {
      assert(Array.isArray(json.location));
      for (const loc of json.location)
        this.location.push(Location.fromJSON(loc));
    }

    if (json.magnet != null) {
      assert(Array.isArray(json.magnet));
      for (const urn of json.magnet)
        this.magnet.push(Magnet.fromJSON(urn));
    }

    if (json.ds != null) {
      assert(Array.isArray(json.ds));
      for (const ds of json.ds)
        this.ds.push(DS.fromJSON(ds));
    }

    if (json.tls != null) {
      assert(Array.isArray(json.tls));
      for (const tls of json.tls)
        this.tls.push(TLS.fromJSON(tls));
    }

    if (json.ssh != null) {
      assert(Array.isArray(json.ssh));
      for (const ssh of json.ssh)
        this.ssh.push(SSH.fromJSON(ssh));
    }

    if (json.pgp != null) {
      assert(Array.isArray(json.pgp));
      for (const pgp of json.pgp)
        this.pgp.push(PGP.fromJSON(pgp));
    }

    if (json.addr != null) {
      assert(Array.isArray(json.addr));
      for (const addr of json.addr)
        this.addr.push(Addr.fromJSON(addr));
    }

    if (json.extra != null) {
      assert(Array.isArray(json.extra));
      for (const extra of json.extra)
        this.extra.push(Extra.fromJSON(extra));
    }

    return this;
  }

  static fromJSON(json) {
    return new this().fromJSON(json);
  }

  inspect() {
    return this.toJSON();
  }
}

exports.ICANN = ICANN;
exports.HSK = HSK;
exports.ICANNP = ICANNP;
exports.ICANNS = ICANNS;
exports.HSKP = HSKP;
exports.HSKS = HSKS;
exports.HSKRecord = HSKRecord;