import { getExifTool, shutdownExifTool } from '../src/main/metadata';
import sharp from 'sharp';
const D='/tmp/claude-0/-home-user-ImageWorld/75d7d373-b95a-54ae-bf9a-b31004413442/scratchpad/backend/';
await sharp({create:{width:50,height:50,channels:3,background:'#fff'}}).jpeg().toFile(D+'s.jpg');
const et=getExifTool();
console.log(await et.write(D+'s.jpg',{GPSLatitude:22.9068,GPSLatitudeRef:'S',GPSLongitude:43.1729,GPSLongitudeRef:'W'},['-overwrite_original']));
console.log(await et.readRaw(D+'s.jpg',['-n','-GPSLatitude','-GPSLongitude','-GPSLatitudeRef','-GPSLongitudeRef']));
console.log(await et.readRaw(D+'s.jpg',['-n','-fast2','-GPSLatitude','-GPSLongitude','-GPSLatitudeRef','-GPSLongitudeRef','-G1']));
await shutdownExifTool();
