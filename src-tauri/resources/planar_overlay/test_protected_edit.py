import unittest,tempfile,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import protected_edit as edit

class ProtectedEditTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.source=self.root/'original.png';self.selection=self.root/'selection.png';self.protect=self.root/'protect.png';self.replacement=self.root/'plate.png'
        Image.new('RGB',(64,48),(210,190,150)).save(self.source)
        selection=Image.new('L',(64,48));ImageDraw.Draw(selection).rectangle((12,12,29,26),fill=255);selection.save(self.selection)
        protection=Image.new('L',(64,48));ImageDraw.Draw(protection).line((20,0,20,47),fill=255,width=3);protection.save(self.protect)
        Image.new('RGB',(64,48),(40,80,110)).save(self.replacement)
        self.request={'mode':'compose','sourceImage':str(self.source),'selectionMask':str(self.selection),'protectionMask':str(self.protect),'replacementImage':str(self.replacement),'sourceSha256':edit.digest(self.source),'selectionSha256':edit.digest(self.selection),'protectionSha256':edit.digest(self.protect),'replacementSha256':edit.digest(self.replacement),'width':64,'height':48,'maskCoordinates':{'space':'native'}}
    def tearDown(self):self.tmp.cleanup()
    def test_selection_never_overrides_protection_or_source_outside_alpha(self):
        report=edit.run(self.request,self.root/'out');made=np.asarray(Image.open(report['image']));src=np.asarray(Image.open(self.source));mask=np.asarray(Image.open(self.selection));protected=np.asarray(Image.open(self.protect))
        self.assertTrue(np.array_equal(made[(mask==0)|(protected>0)],src[(mask==0)|(protected>0)]));self.assertEqual(made[15,15].tolist(),[40,80,110]);self.assertTrue(report['blockedSelectionPixels']>0)
    def test_native_matte_contains_explicit_background_holes(self):
        mask=edit.rasterize_matte((64,48),[[[5,5],[50,5],[50,40],[5,40]]],[[[20,15],[30,15],[30,25],[20,25]]]);a=np.asarray(mask);self.assertEqual(a[10,10],255);self.assertEqual(a[20,25],0);self.assertEqual(a[0,0],0)
    def test_crop_mapping_places_mask_by_pixel_center_without_source_resize(self):
        small=Image.fromarray(np.array([[255,0],[0,128]],np.uint8));mapped,meta=edit.map_selection(small,(64,48),{'space':'crop','x':7,'y':9,'width':4,'height':4})
        self.assertEqual(mapped[9:13,7:11].tolist(),[[255,255,0,0],[255,255,0,0],[0,0,128,128],[0,0,128,128]]);self.assertEqual(np.count_nonzero(mapped[:9]),0);self.assertEqual(meta['resampling'],'nearest_mask_only')
    def test_invalid_native_size_and_crop_are_rejected(self):
        for coords in [{'space':'native'},{'space':'crop','x':63,'y':0,'width':4,'height':4},{'space':'crop','x':True,'y':0,'width':4,'height':4}]:
            with self.assertRaises(ValueError):edit.map_selection(Image.new('L',(2,2)),(64,48),coords)
    def test_bad_hash_has_no_output_or_input_changes(self):
        with self.assertRaisesRegex(ValueError,'hash_mismatch'):edit.run({**self.request,'sourceSha256':'0'*64},self.root/'out')
        self.assertFalse((self.root/'out').exists());self.assertEqual(edit.digest(self.source),self.request['sourceSha256'])
    def test_transparent_rgba_replacement_cannot_paint_source(self):
        original=Image.new('RGB',(64,48),(12,34,56));replacement=Image.new('RGBA',(64,48),(200,0,0,0));made,alpha=edit.blend_protected(original,replacement,np.full((48,64),255,np.uint8),np.zeros((48,64),np.uint8));self.assertTrue(np.array_equal(made,np.asarray(original)));self.assertEqual(alpha.max(),0)
    def test_glyph_fill_reconstructs_shadow_gradient_without_grid_donor_bleed(self):
        yy,xx=np.mgrid[:48,:64];plain=np.stack([150+xx+yy,140+xx+yy,110+xx+yy],axis=2).astype(np.uint8);source=plain.copy();mask=np.zeros((48,64),np.uint8);mask[16:23,24:31]=255;source[mask>0]=[40,30,20];protection=np.zeros_like(mask);protection[:,19:22]=255;source[protection>0]=[25,20,15]
        result=np.asarray(edit.repair_glyph_surface(Image.fromarray(source),mask,protection));self.assertLessEqual(np.abs(result[mask>0].astype(int)-plain[mask>0]).max(),1);self.assertTrue(np.array_equal(result[mask==0],source[mask==0]))
    def test_exact_text_layer_collision_rejects_instead_of_clipping(self):
        layer=Image.new('RGBA',(64,48));layer.putpixel((20,20),(0,0,0,255));layer.save(self.replacement)
        r={**self.request,'mode':'erase-text','requiredText':'내 시간','replacementSha256':edit.digest(self.replacement)}
        with self.assertRaisesRegex(ValueError,'exact_text_intersects_protection'):edit.run(r,self.root/'out')
        self.assertFalse((self.root/'out').exists())
    def test_exact_text_literal_and_binary_cleanup_are_strict(self):
        with self.assertRaisesRegex(ValueError,'unsupported_exact_text'):edit.run({**self.request,'requiredText':'가짜'},self.root/'out')
        mask=Image.new('L',(64,48),128);mask.save(self.selection);r={**self.request,'mode':'erase-text','selectionSha256':edit.digest(self.selection)}
        with self.assertRaisesRegex(ValueError,'binary_selection'):edit.run(r,self.root/'out')
    def test_existing_output_and_original_are_preserved(self):
        out=self.root/'out';out.mkdir();(out/'keep').write_text('preserve')
        with self.assertRaises(FileExistsError):edit.run(self.request,out)
        self.assertEqual((out/'keep').read_text(),'preserve');self.assertEqual(edit.digest(self.source),self.request['sourceSha256'])
if __name__=='__main__':unittest.main()
