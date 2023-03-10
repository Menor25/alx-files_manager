import sha1 from 'sha1';
import { expect } from 'chai';
import request from 'supertest';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import app from '../../server';
import dbClient from '../../utils/db';
import redisClient from '../../utils/redis';

const { exec } = require('child_process');

const execAsyc = promisify(exec);

const fs = require('fs');

async function addUser(data) {
  const userInfo = await dbClient.db.collection('users').insertOne(data);
  const usertoken = uuidv4();
  await redisClient.set(`auth_${usertoken}`, userInfo.ops[0]._id.toString(), 90);

  return [userInfo, usertoken];
}

describe('filesController', () => {
  after(async () => {
    await dbClient.db.collection('files').deleteMany({});
    await dbClient.db.collection('users').deleteMany({});
    await execAsyc('rm -r /tmp/files_manager');
  });

  describe('pOST /files', () => {
    let mockUserInfo = null;
    let mockUserToken = null;
    const mockUser = { email: 'tester@test.com', password: sha1('secret~!') };

    let mockFolderInfo = null;
    let mockFileInfo = null;

    beforeEach(async () => {
      await dbClient.db.collection('files').deleteMany({});
      await dbClient.db.collection('users').deleteMany({});

      // Add one user
      [mockUserInfo, mockUserToken] = await addUser(mockUser);

      // Add one folder
      const mockFolder = {
        userId: mockUserInfo.ops[0]._id,
        name: 'music',
        type: 'folder',
        isPublic: true,
        parentId: '0',
      };
      mockFolderInfo = await dbClient.db.collection('files').insertOne(mockFolder);

      // Add one file
      const mockFile = {
        userId: mockUserInfo.ops[0]._id,
        name: 'song.mp3',
        type: 'file',
        isPublic: true,
        parentId: mockFolderInfo.ops[0]._id,
      };
      mockFileInfo = await dbClient.db.collection('files').insertOne(mockFile);
    });

    it('fails when user token is invalid', async () => {
      const res = await request(app).post('/files')
        .set('X-Token', `${mockUserToken}!`);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'Unauthorized' });

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(2);
    });

    it("fails when 'name' is missing", async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({ type: 'folder' });
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.deep.equal({ error: 'Missing name' });

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(2);
    });

    it("fails when 'type' is missing", async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({ name: 'file.txt' });
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.deep.equal({ error: 'Missing type' });

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(2);
    });

    it("fails if 'type' != 'folder' and 'data' is missing", async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({ name: 'music', type: 'file' });
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.deep.equal({ error: 'Missing data' });

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(2);
    });

    it("fails if 'parentId' is invalid", async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({ name: 'file.txt', type: 'folder', parentId: 2332 });
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.deep.equal({ error: 'Parent not found' });

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(2);
    });

    it.skip("fails if 'parentId' is not a folder", async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({
          name: 'file.txt',
          type: 'folder',
          parentId: mockFileInfo.ops[0]._id.toString(),
        });
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.deep.equal({ error: 'Parent not found' });

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(2);
    });

    it('successfully creates a folder at the root', async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({
          name: 'videos',
          type: 'folder',
        });
      expect(res.statusCode).to.equal(201);
      expect(res.body.name).to.equal('videos');
      expect(res.body.type).to.equal('folder');
      expect(res.body.isPublic).to.equal(false);
      expect(res.body.userId).to.equal(mockUserInfo.ops[0]._id.toString());

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(3);
    });

    it('successfully creates a folder inside a folder', async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({
          name: 'slowMusic',
          type: 'folder',
          parentId: mockFolderInfo.ops[0]._id,
        });
      expect(res.statusCode).to.equal(201);
      expect(res.body.name).to.equal('slowMusic');
      expect(res.body.type).to.equal('folder');
      expect(res.body.isPublic).to.equal(false);
      expect(res.body.userId).to.equal(mockUserInfo.ops[0]._id.toString());
      expect(res.body.parentId).to.equal(mockFolderInfo.ops[0]._id.toString());

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(3);
    });

    it('successfully creates a file at the root', async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({
          name: 'hello.txt',
          type: 'file',
          isPublic: true,
          parentId: 0,
          data: Buffer.from('Hello!', 'binary').toString('base64'),
        });
      expect(res.statusCode).to.equal(201);
      expect(res.body.name).to.equal('hello.txt');
      expect(res.body.type).to.equal('file');
      expect(res.body.isPublic).to.equal(true);
      expect(res.body.parentId).to.equal(0);
      expect(res.body.userId).to.equal(mockUserInfo.ops[0]._id.toString());

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(3);

      expect(fs.existsSync(res.body.localPath)).to.equal(true);
      const readFileAsync = promisify(fs.readFile);
      const fileContent = await readFileAsync(res.body.localPath);
      expect(Buffer.from(fileContent, 'base64').toString()).to.deep.equal('Hello!');
    });

    it('successfully creates a file inside a folder', async () => {
      const res = await request(app).post('/files')
        .set('X-Token', mockUserToken)
        .send({
          name: 'hello.txt',
          type: 'file',
          isPublic: true,
          parentId: mockFolderInfo.ops[0]._id.toString(),
          data: Buffer.from('Hello!', 'binary').toString('base64'),
        });
      expect(res.statusCode).to.equal(201);
      expect(res.body.name).to.equal('hello.txt');
      expect(res.body.type).to.equal('file');
      expect(res.body.isPublic).to.equal(true);
      expect(res.body.userId).to.equal(mockUserInfo.ops[0]._id.toString());
      expect(res.body.parentId).to.equal(mockFolderInfo.ops[0]._id.toString());

      const docs = await dbClient.db.collection('files').find({}).toArray();
      expect(docs.length).to.not.be.greaterThan(3);

      expect(fs.existsSync(res.body.localPath)).to.equal(true);
      const readFileAsync = promisify(fs.readFile);
      const fileContent = await readFileAsync(res.body.localPath);
      expect(Buffer.from(fileContent, 'base64').toString()).to.deep.equal('Hello!');
    });
  });

  describe('gET /files/:id', () => {
    let mockUser0info = null;
    let mockUser0Token = null;
    let mockUser1Token = null;

    let mockFolderInfo = null;

    beforeEach(async () => {
      await dbClient.db.collection('files').deleteMany({});
      await dbClient.db.collection('users').deleteMany({});

      // Add two users
      [mockUser0info, mockUser0Token] = await addUser({
        email: 'tester0@test.com',
        password: sha1('secret~!'),
      });

      [, mockUser1Token] = await addUser({
        email: 'tester1@test.com',
        password: sha1('secret~!'),
      });

      // Add one folder
      const mockFolder = {
        userId: mockUser0info.ops[0]._id,
        name: 'music',
        type: 'folder',
        isPublic: true,
        parentId: '0',
      };
      mockFolderInfo = await dbClient.db.collection('files').insertOne(mockFolder);
    });

    it('fails when user token is invalid', async () => {
      const res = await request(app).get(`/files/${mockFolderInfo.ops[0]._id}`)
        .set('X-Token', `${mockUser0Token}!`);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'Unauthorized' });
    });

    it("fails when ':id' is invalid", async () => {
      const res = await request(app).get('/files/5f1e8896c7ba06511e683b25!')
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.deep.equal({ error: 'Id not in BSON format' });
    });

    it("fails when no file is linked to ':id'", async () => {
      const res = await request(app).get('/files/5f1e8896c7ba06511e683b25')
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it("fails when no file is linked to ':id' for this user", async () => {
      const res = await request(app).get(`/files/${mockFolderInfo.ops[0]._id}`)
        .set('X-Token', `${mockUser1Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it("successfully retrieves file when ':id' is correct with rightfull owner", async () => {
      const res = await request(app).get(`/files/${mockFolderInfo.ops[0]._id}`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.name).to.equal('music');
      expect(res.body.type).to.equal('folder');
      expect(res.body.isPublic).to.equal(true);
      expect(res.body.userId).to.equal(mockUser0info.ops[0]._id.toString());
    });
  });

  describe('gET /files', () => {
    let mockUserInfo = null;
    let mockUserToken = null;
    const mockUser = { email: 'tester@test.com', password: sha1('secret~!') };

    let mockFolderInfo = null;

    beforeEach(async () => {
      await dbClient.db.collection('files').deleteMany({});
      await dbClient.db.collection('users').deleteMany({});

      // Add one user
      [mockUserInfo, mockUserToken] = await addUser(mockUser);

      // Add one folder
      const mockFolder = {
        userId: mockUserInfo.ops[0]._id,
        name: 'Notes',
        type: 'folder',
        isPublic: true,
        parentId: '0',
      };
      mockFolderInfo = await dbClient.db.collection('files').insertOne(mockFolder);

      // Add 45 files
      const files = [];
      for (let i = 0; i < 45; i += 1) {
        const mockFile = {
          userId: mockUserInfo.ops[0]._id,
          name: `file${i}`,
          type: 'file',
          isPublic: true,
          parentId: mockFolderInfo.ops[0]._id,
        };
        files.push(mockFile);
      }
      await dbClient.db.collection('files').insertMany(files);
    });

    it('fails when user token is invalid', async () => {
      const res = await request(app).get('/files')
        .set('X-Token', `${mockUserToken}!`);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'Unauthorized' });
    });

    it("successfully retrieves files with no 'parentId' and no 'page'", async () => {
      const res = await request(app).get('/files')
        .set('X-Token', `${mockUserToken}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.length).to.equal(0);
    });

    it("gets no file when 'parentId' is wrong and no 'page'", async () => {
      const res = await request(app).get('/files?')
        .query({ parentId: '5f1e881cc7ba06511e683b23' })
        .set('X-Token', `${mockUserToken}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.length).to.equal(0);
    });

    it("successfully retrieves files with valid 'parentId' and no 'page'", async () => {
      const res = await request(app).get('/files')
        .query({ parentId: `${mockFolderInfo.ops[0]._id.toString()}` })
        .set('X-Token', `${mockUserToken}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.length).to.equal(20);

      for (const file of res.body) {
        const fileNum = Number(file.name.split('')[4]);
        expect(fileNum).to.not.be.greaterThan(19);
        expect(file.parentId).to.equal(mockFolderInfo.ops[0]._id.toString());
      }
    });

    it("successfully retrieves files with 'parentId' and second 'page'", async () => {
      const res = await request(app).get('/files')
        .query({
          page: 1,
          parentId: `${mockFolderInfo.ops[0]._id.toString()}`,
        })
        .set('X-Token', `${mockUserToken}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.length).to.equal(20);

      for (const file of res.body) {
        const fileNum = Number(file.name.split('')[4]);
        expect(fileNum).to.not.be.greaterThan(39);
        expect(file.parentId).to.equal(mockFolderInfo.ops[0]._id.toString());
      }
    });

    it("retrieves no files with 'parentId' and 'page' to far", async () => {
      const res = await request(app).get('/files')
        .query({
          page: 5,
          parentId: `${mockFolderInfo.ops[0]._id.toString()}`,
        })
        .set('X-Token', `${mockUserToken}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.length).to.equal(0);
    });
  });

  describe('gET /files/me', () => {
    let mockUserInfo = null;
    let mockUserToken = null;
    const mockUser = { email: 'tester@test.com', password: sha1('secret~!') };

    let mockFolderInfo = null;

    beforeEach(async () => {
      await dbClient.db.collection('files').deleteMany({});
      await dbClient.db.collection('users').deleteMany({});

      // Add one user
      [mockUserInfo, mockUserToken] = await addUser(mockUser);

      // Add one folder
      const mockFolder = {
        userId: mockUserInfo.ops[0]._id,
        name: 'Notes',
        type: 'folder',
        isPublic: true,
        parentId: '0',
      };
      mockFolderInfo = await dbClient.db.collection('files').insertOne(mockFolder);

      // Add 45 files
      const files = [];
      for (let i = 0; i < 45; i += 1) {
        const mockFile = {
          userId: mockUserInfo.ops[0]._id,
          name: `file${i}`,
          type: 'file',
          isPublic: true,
          parentId: mockFolderInfo.ops[0]._id,
        };
        files.push(mockFile);
      }
      await dbClient.db.collection('files').insertMany(files);
    });

    it('fails when user token is invalid', async () => {
      const res = await request(app).get('/files/me')
        .set('X-Token', `${mockUserToken}!`);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'Unauthorized' });
    });

    it("successfully retrieves files with no 'page'", async () => {
      const res = await request(app).get('/files/me')
        .set('X-Token', `${mockUserToken}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.length).to.equal(20);
      expect(res.body[0].userId).to.equal(mockUserInfo.ops[0]._id.toString());
    });

    it("successfully retrieves files for second 'page'", async () => {
      const res = await request(app).get('/files/me')
        .query({
          page: 1,
        })
        .set('X-Token', `${mockUserToken}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.length).to.equal(20);

      for (const file of res.body) {
        const fileNum = Number(file.name.split('')[4]);
        expect(fileNum).to.not.be.greaterThan(39);
        expect(file.userId).to.equal(mockUserInfo.ops[0]._id.toString());
        expect(file.parentId).to.equal(mockFolderInfo.ops[0]._id.toString());
      }
    });

    it("retrieves no files with 'page' to far", async () => {
      const res = await request(app).get('/files/me')
        .query({
          page: 5,
        })
        .set('X-Token', `${mockUserToken}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.length).to.equal(0);
    });
  });

  describe('pUT /files/:id/publish', () => {
    let mockUser0info = null;
    let mockUser0Token = null;
    let mockUser1Token = null;

    let mockFolderInfo = null;

    beforeEach(async () => {
      await dbClient.db.collection('files').deleteMany({});
      await dbClient.db.collection('users').deleteMany({});

      // Add two users
      [mockUser0info, mockUser0Token] = await addUser({
        email: 'tester0@test.com',
        password: sha1('secret~!'),
      });

      [, mockUser1Token] = await addUser({
        email: 'tester1@test.com',
        password: sha1('secret~!'),
      });

      const mockFolder = {
        userId: mockUser0info.ops[0]._id,
        name: 'music',
        type: 'folder',
        isPublic: false,
        parentId: '0',
      };
      mockFolderInfo = await dbClient.db.collection('files').insertOne(mockFolder);
    });

    it('fails when user token is invalid', async () => {
      const res = await request(app).put('/files/5f1e881cc7ba06511e683b23/publish')
        .set('X-Token', `${mockUser0Token}!`);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'Unauthorized' });
    });

    it('fails when no file is linked to :id', async () => {
      const res = await request(app).put('/files/5f1e881cc7ba06511e683b23/publish')
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it('fails when no file is linked to :id for this user', async () => {
      const res = await request(app).put(`/files/${mockFolderInfo.ops[0]._id.toString()}/publish`)
        .set('X-Token', `${mockUser1Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it('successfully sets isPublic to true when user is owner & :id is correct', async () => {
      const res = await request(app).put(`/files/${mockFolderInfo.ops[0]._id.toString()}/publish`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(200);

      const file = await dbClient.db.collection('files').findOne({
        _id: mockFolderInfo.ops[0]._id,
        userId: mockUser0info.ops[0]._id,
      });

      expect(file.isPublic).to.equal(true);
    });
  });

  describe('pUT /files/:id/unpublish', () => {
    let mockUser0info = null;
    let mockUser0Token = null;
    let mockUser1Token = null;

    let mockFolderInfo = null;

    beforeEach(async () => {
      await dbClient.db.collection('files').deleteMany({});
      await dbClient.db.collection('users').deleteMany({});

      // Add two users
      [mockUser0info, mockUser0Token] = await addUser({
        email: 'tester0@test.com',
        password: sha1('secret~!'),
      });

      [, mockUser1Token] = await addUser({
        email: 'tester1@test.com',
        password: sha1('secret~!'),
      });

      // Add 1 folder
      const mockFolder = {
        userId: mockUser0info.ops[0]._id,
        name: 'music',
        type: 'folder',
        isPublic: true,
        parentId: '0',
      };
      mockFolderInfo = await dbClient.db.collection('files').insertOne(mockFolder);
    });

    it('fails when user token is invalid', async () => {
      const res = await request(app).put('/files/5f1e881cc7ba06511e683b23/unpublish')
        .set('X-Token', `${mockUser0Token}!`);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'Unauthorized' });
    });

    it('fails when no file is linked to :id', async () => {
      const res = await request(app).put('/files/5f1e881cc7ba06511e683b23/unpublish')
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it('fails when no file is linked to :id for this user', async () => {
      const res = await request(app).put(`/files/${mockFolderInfo.ops[0]._id.toString()}/unpublish`)
        .set('X-Token', `${mockUser1Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it('successfully sets isPublic to false when user is owner & :id is correct', async () => {
      const res = await request(app).put(`/files/${mockFolderInfo.ops[0]._id.toString()}/unpublish`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(200);

      const file = await dbClient.db.collection('files').findOne({
        _id: mockFolderInfo.ops[0]._id,
        userId: mockUser0info.ops[0]._id,
      });

      expect(file.isPublic).to.equal(false);
    });
  });

  describe('dELETE /files', () => {
    let mockUser0info = null;
    let mockUser0Token = null;
    let mockUser1Info = null;
    let mockUser1Token = null;

    // const mockFolderInfo = null;
    let mockUser1FileInfo = null;

    beforeEach(async () => {
      await dbClient.db.collection('files').deleteMany({});
      await dbClient.db.collection('users').deleteMany({});

      // Add two users
      [mockUser0info, mockUser0Token] = await addUser({
        email: 'tester0@test.com',
        password: sha1('secret~!'),
      });

      [mockUser1Info, mockUser1Token] = await addUser({
        email: 'tester1@test.com',
        password: sha1('secret~!'),
      });

      // Add one file
      const mockUser1File = {
        userId: mockUser1Info.ops[0]._id,
        name: 'hello.txt',
        type: 'file',
        isPublic: true,
        parentId: '0',
      };
      mockUser1FileInfo = await dbClient.db.collection('files').insertOne(mockUser1File);
    });

    it('fails when user token is invalid', async () => {
      const res = await request(app).delete('/files/5f1e881cc7ba06511e683b23')
        .set('X-Token', `${mockUser0Token}!`);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'Unauthorized' });
    });

    it('fails when no file is linked to :id', async () => {
      const res = await request(app).delete('/files/5f1e881cc7ba06511e683b23')
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it('fails when no file is linked to :id for this user', async () => {
      const res = await request(app).delete(`/files/${mockUser1FileInfo.ops[0]._id.toString()}`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(403);
      expect(res.body).to.deep.equal({ error: 'Permission denied' });
    });

    it.skip('successfully deletes file linked to :id for this user', async () => {
    // create a file in DB and disk
      const file = {
        userId: mockUser1Info.ops[0]._id,
        name: 'testFile',
        type: 'file',
        isPublic: true,
        parentId: 0,
      };
      const fileInfo = await dbClient.db.collection('files').insertOne(file);
      const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
      const filePath = `${folderPath}/${fileInfo.ops[0]._id}`;
      console.log(filePath);
      await dbClient.db.collection('files').updateOne(
        {
          _id: fileInfo.insertedId,
        },
        { $set: { localPath: filePath } },
      );
      fs.writeFile(filePath, 'Hello!', () => {});

      expect(fs.existsSync(filePath)).to.equal(true);

      // Make delete request
      const res = await request(app).delete(`/files/${fileInfo.ops[0]._id}`)
        .set('X-Token', `${mockUser1Token}`);
      expect(res.statusCode).to.equal(204);

      const doc = await dbClient.db.collection('files').findOne({ _id: fileInfo.ops[0]._id });
      expect(doc).to.equal(null);
      setTimeout(() => {}, 20000);
      expect(fs.existsSync(filePath)).to.equal(false);
    });

    it.skip('successfully deletes folder linked to :id for this user', async () => {
    // create a folder in DB
      const folder = {
        userId: mockUser1Info.ops[0]._id,
        name: 'testFolder',
        type: 'folder',
        isPublic: true,
        parentId: 0,
      };
      const folderInfo = await dbClient.db.collection('files').insertOne(folder);
      expect(folderInfo).is.not.equal(null);

      // Make delete request
      const res = await request(app).delete(`/files/${folderInfo.ops[0]._id.toString()}`)
        .set('X-Token', `${mockUser1Token}`);
      expect(res.statusCode).to.equal(204);

      const doc = await dbClient.db.collection('files').findOne({ _id: folderInfo.ops[0]._id });
      expect(doc).to.equal(null);
    });

    it.skip('successfully deletes a folder and its content', async () => {
    // Add 2 folders
      const folder1 = {
        userId: mockUser0info.ops[0]._id,
        name: 'pictures',
        type: 'folder',
        isPublic: true,
        parentId: '0',
      };
      const folder1Info = await dbClient.db.collection('files').insertOne(folder1);

      const folder2 = { ...folder1 };
      folder2.name = 'videos';
      folder2.parentId = folder1Info.ops[0]._id;
      delete folder2._id;

      const folder2Info = await dbClient.db.collection('files').insertOne(folder2);

      const filesPath = [];
      for (let i = 1; i <= 10; i += 1) {
        let parentId = folder1Info.ops[0]._id;
        if (i >= 5) parentId = folder2Info.ops[0]._id;

        const mockFile = {
          userId: mockUser0info.ops[0]._id,
          name: `file${i}`,
          type: 'file',
          isPublic: true,
          parentId,
        };
        // Add file in DB
        const mockFileInfo = await dbClient.db.collection('files').insertOne(mockFile);
        // Add file in disk
        const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
        const filePath = `${folderPath}/${mockFileInfo.ops[0]._id}`;
        const fileContent = 'Hello!';

        filesPath.push(filePath);

        await dbClient.db.collection('files').updateOne(
          {
            _id: mockFileInfo.insertedId,
          },
          { $set: { localPath: filePath } },
        );

        fs.writeFile(filePath, fileContent, () => {});
      }
      console.log(filesPath);

      // Make delete request
      const res = await request(app).delete(`/files/${folder1Info.ops[0]._id.toString()}`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(204);
      const doc = await dbClient.db.collection('files').findOne({ _id: folder1Info.ops[0]._id });
      console.log('the doc is: ', doc);
      // expect(doc).to.equal(null);

      for (const path of filesPath) {
        const id = path.split('r/')[1];
        expect(fs.existsSync(path)).to.equal(false);
        const doc = await dbClient.db.collection('files').findOne({ _id: id });

        expect(doc).to.equal(null);
      }
    });
  });

  describe('gET /files/:id/data', () => {
    let mockUser0info = null;
    let mockUser0Token = null;
    let mockUser1Token = null;

    let mockFolderInfo = null;
    let mockFileInfo0 = null;
    let mockFileInfo1 = null;
    let folderPath = null;
    let filePath = null;
    let fileContent = null;

    beforeEach(async () => {
      await dbClient.db.collection('files').deleteMany({});
      await dbClient.db.collection('users').deleteMany({});

      // Add two users
      [mockUser0info, mockUser0Token] = await addUser({
        email: 'tester0@test.com',
        password: sha1('secret~!'),
      });

      [, mockUser1Token] = await addUser({
        email: 'tester1@test.com',
        password: sha1('secret~!'),
      });

      // Add one folder owned by user 0
      const mockFolder = {
        userId: mockUser0info.ops[0]._id,
        name: 'Notes',
        type: 'folder',
        isPublic: false,
        parentId: '0',
      };
      mockFolderInfo = await dbClient.db.collection('files').insertOne(mockFolder);

      // Add one file owned by user 0
      folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
      filePath = `${folderPath}/${uuidv4()}`;
      fileContent = 'Hello!';

      fs.writeFile(filePath, fileContent, () => {});

      let mockFile = {
        userId: mockUser0info.ops[0]._id,
        name: 'file.txt',
        type: 'file',
        isPublic: false,
        parentId: mockFolderInfo.ops[0]._id,
        localPath: filePath,
      };
      mockFileInfo0 = await dbClient.db.collection('files').insertOne(mockFile);

      // Add second file with invalid localPath
      mockFile = {
        userId: mockUser0info.ops[0]._id,
        name: 'file.txt',
        type: 'file',
        isPublic: false,
        parentId: mockFolderInfo.ops[0]._id,
        localPath: '/notExisting/path',
      };
      mockFileInfo1 = await dbClient.db.collection('files').insertOne(mockFile);
    });

    it('fails when no file is linked to :id', async () => {
      const res = await request(app).get('/files/5f1e879ec7ba06511e683b22/data');
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it('fails when file linked to :id is unpublished & user is unauthenticated', async () => {
      const res = await request(app).get(`/files/${mockFileInfo0.ops[0]._id}/data`)
        .set('X-Token', `${mockUser0Token}!`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it('fails when file linked to :id is unpublished & user authenticated but not owner', async () => {
      const res = await request(app).get(`/files/${mockFileInfo0.ops[0]._id.toString()}/data`)
        .set('X-Token', `${mockUser1Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });

    it('succefully gets unpublished file linked to :id with user authenticated and is owner', async () => {
      const res = await request(app).get(`/files/${mockFileInfo0.ops[0]._id.toString()}/data`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(200);
      expect(res.text).to.equal(fileContent);
    });

    it('succefully gets published file linked to :id with user authenticated', async () => {
      await dbClient.db.collection('files').updateOne(
        {
          _id: mockFileInfo0.ops[0]._id,
          userId: mockUser0info.ops[0]._id,
        },
        { $set: { isPublic: true } },
      );

      const res = await request(app).get(`/files/${mockFileInfo0.ops[0]._id.toString()}/data`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(200);
      expect(res.text).to.equal(fileContent);
    });

    it('succefully gets published file linked to :id with user unauthenticated', async () => {
      await dbClient.db.collection('files').updateOne(
        {
          _id: mockFileInfo0.ops[0]._id,
          userId: mockUser0info.ops[0]._id,
        },
        { $set: { isPublic: true } },
      );

      const res = await request(app).get(`/files/${mockFileInfo0.ops[0]._id.toString()}/data`)
        .set('X-Token', `${mockUser0Token}!`);
      expect(res.statusCode).to.equal(200);
      expect(res.text).to.equal(fileContent);
    });

    it('fails when file linked to :id is a folder', async () => {
      const res = await request(app).get(`/files/${mockFolderInfo.ops[0]._id.toString()}/data`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(400);
      expect(res.body).to.deep.equal({ error: "A folder doesn't have content" });
    });

    it('fails when file linked to :id is a not present locally', async () => {
      const res = await request(app).get(`/files/${mockFileInfo1.ops[0]._id.toString()}/data`)
        .set('X-Token', `${mockUser0Token}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Not found' });
    });
  });
});