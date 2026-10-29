// SPDX-License-Identifier: MIT
globalThis.fm1App = {
  load(fm1) { this.last = -1; this.ready = false; fm1.ex.gg_web_hold(); },
  message(fm1, m) {
    const ex=fm1.ex;
    if (m.action === "restore-journal") {
      if (this.ready) return;
      const bytes=new Uint8Array(m.bytes || []);
      if (bytes.length === ex.gg_web_journal_size() || bytes.length === 73728) {
        new Uint8Array(fm1.mem.buffer,ex.gg_web_journal(),bytes.length).set(bytes);
        // gg_init has already booted the core but not advanced it. Reload its
        // SRAM from the restored flash before the first emulated instruction.
      }
      ex.gg_web_reload();
      this.ready=true;
    } else if (m.action === "manager") {
      const data=new Uint8Array(m.bytes);
      if(data.length>264)return;
      new Uint8Array(fm1.mem.buffer,ex.gg_web_request_ptr(),data.length).set(data);
      const n=ex.gg_web_request_run(data.length);
      const answer=new Uint8Array(fm1.mem.buffer,ex.gg_web_answer_ptr(),n).slice();
      fm1.port.postMessage({type:"app",action:"manager-reply",id:m.id,bytes:answer},[answer.buffer]);
    } else if (m.action === "export") {
      const bytes=new Uint8Array(fm1.mem.buffer,ex.gg_web_sram(),32768).slice();
      fm1.port.postMessage({type:"app",action:"save-file",bytes},[bytes.buffer]);
    } else if (m.action === "import") {
      const bytes=new Uint8Array(m.bytes || []);
      if (bytes.length!==32768 || (ex.gg_web_status() & 65536)) {
        fm1.port.postMessage({type:"app",action:"error",text:"Stop playback and select a 32 KiB .sav file."});return;
      }
      new Uint8Array(fm1.mem.buffer,ex.gg_web_sram(),32768).set(bytes);
      ex.gg_web_import();
      fm1.port.postMessage({type:"app",action:"imported"});
    }
  },
  process(fm1) {
    if (!this.ready) { fm1.port.postMessage({type:"app",action:"journal-request"});return; }
    const ex=fm1.ex, generation=ex.gg_web_generation()+":"+ex.gg_web_revision();
    if(ex.gg_web_busy())return;
    if (generation===this.last)return;
    this.last=generation;
    const bytes=new Uint8Array(fm1.mem.buffer,ex.gg_web_journal(),ex.gg_web_journal_size()).slice();
    fm1.port.postMessage({type:"app",action:"journal",bytes},[bytes.buffer]);
  }
};
