import { Link } from "wouter";
import { Terminal, AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background text-foreground font-mono p-6">
      <div className="scanline"></div>
      
      <div className="max-w-md w-full border border-destructive bg-card p-6 shadow-2xl shadow-destructive/10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-destructive"></div>
        
        <div className="flex items-center gap-3 text-destructive mb-6">
          <AlertTriangle className="w-8 h-8 animate-pulse" />
          <h1 className="text-2xl font-bold">[ ERROR ] 404 // SIGNAL LOST</h1>
        </div>
        
        <div className="space-y-4 text-sm text-muted-foreground mb-8">
          <p>FATAL: Target node not found in routing table.</p>
          <p className="text-destructive/80">Trace: GET /undefined_route</p>
          <p>The module you are looking for has been unloaded or never existed.</p>
        </div>
        
        <Link href="/" className="inline-flex items-center gap-2 text-primary hover:text-primary/80 hover:bg-primary/10 px-4 py-2 border border-primary transition-colors group">
          <Terminal className="w-4 h-4" /> 
          <span>Return to Core</span>
          <span className="w-2 h-4 bg-primary animate-pulse ml-1 opacity-0 group-hover:opacity-100"></span>
        </Link>
      </div>
    </div>
  );
}
