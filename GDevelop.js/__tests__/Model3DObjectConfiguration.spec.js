const initializeGDevelopJs = require('../../Binaries/embuild/GDevelop.js/libGD.js');

describe('libGD.js - Model3DObjectConfiguration serialization', function () {
  let gd = null;
  let project = null;
  beforeAll(async () => {
    gd = await initializeGDevelopJs();
    project = gd.ProjectHelper.createNewGDJSProject();
  });
  afterAll(() => project && project.delete());

  const readUseInstancing = (configuration) => {
    const properties = configuration.getProperties();
    expect(properties.has('useInstancing')).toBe(true);
    return properties.get('useInstancing').getValue();
  };

  it('round-trips useInstancing set to true through serialization', function () {
    const serializerElement = new gd.SerializerElement();
    {
      const configuration = new gd.Model3DObjectConfiguration();
      expect(readUseInstancing(configuration)).toBe('false');

      expect(configuration.updateProperty('useInstancing', 'true')).toBe(true);
      expect(readUseInstancing(configuration)).toBe('true');

      configuration.serializeTo(serializerElement);
      configuration.delete();
    }
    {
      const configuration = new gd.Model3DObjectConfiguration();
      configuration.unserializeFrom(project, serializerElement);
      expect(readUseInstancing(configuration)).toBe('true');
      configuration.delete();
    }
    serializerElement.delete();
  });

  it('keeps the default (useInstancing false) through serialization', function () {
    const serializerElement = new gd.SerializerElement();
    {
      const configuration = new gd.Model3DObjectConfiguration();
      configuration.serializeTo(serializerElement);
      configuration.delete();
    }
    const configuration = new gd.Model3DObjectConfiguration();
    configuration.unserializeFrom(project, serializerElement);
    expect(readUseInstancing(configuration)).toBe('false');
    configuration.delete();
    serializerElement.delete();
  });

  it('unserializes useInstancing set to true in the serialized element', function () {
    const serializerElement = new gd.SerializerElement();
    {
      const configuration = new gd.Model3DObjectConfiguration();
      configuration.updateProperty('useInstancing', 'true');
      configuration.serializeTo(serializerElement);
      configuration.delete();
    }
    const configuration = new gd.Model3DObjectConfiguration();
    configuration.unserializeFrom(project, serializerElement);
    expect(readUseInstancing(configuration)).toBe('true');
    configuration.delete();
    serializerElement.delete();
  });
});
