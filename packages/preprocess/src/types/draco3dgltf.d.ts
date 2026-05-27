declare module 'draco3dgltf' {
  interface DracoModuleFactory {
    createDecoderModule(): Promise<unknown>;
    createEncoderModule(): Promise<unknown>;
  }

  const draco3d: DracoModuleFactory;
  export default draco3d;
}
