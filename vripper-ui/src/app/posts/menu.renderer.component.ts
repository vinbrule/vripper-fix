import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { AgRendererComponent } from 'ag-grid-angular';
import { PostState } from './post-state.model';
import { PostDetailComponent } from '../post-detail/post-detail.component';
import { MatDialog, MatSnackBar } from '@angular/material';
import { HttpClient } from '@angular/common/http';
import { BreakpointObserver, BreakpointState, Breakpoints } from '@angular/cdk/layout';
import { Observable, Subscription } from 'rxjs';
import { WsConnectionService } from '../ws-connection.service';
import { WsHandler } from '../ws-handler';
import { ServerService } from '../server-service';
import { ICellRendererParams } from 'ag-grid-community';
import { RemoveResponse } from '../common/remove-response.model';
import { ConfirmDialogComponent } from '../common/confirmation-component/confirmation-dialog';
import { filter, flatMap } from 'rxjs/operators';
import { ElectronService } from 'ngx-electron';
import { DownloadPath } from '../common/download-path.model';

@Component({
  selector: 'app-menu-cell',
  template: `
    <div fxLayout="column" fxLayoutAlign="center center" style="height: 48px">
      <button fxFlex="nogrow" mat-icon-button [matMenuTriggerFor]="menu">
        <mat-icon>more_vert</mat-icon>
      </button>
    </div>

    <mat-menu #menu="matMenu">
      <button
        *ngIf="
          postData.status === 'PENDING' ||
          (postData.status === 'COMPLETE' && postData.progress !== 100) ||
          postData.status === 'ERROR' ||
          postData.status === 'STOPPED'
        "
        (click)="restart()"
        mat-menu-item
      >
        <mat-icon>play_arrow</mat-icon>
        <span>Start</span>
      </button>
      <button *ngIf="postData.status === 'DOWNLOADING' || postData.status === 'PARTIAL'" (click)="stop()" mat-menu-item>
        <ng-container>
          <mat-icon>stop</mat-icon>
          <span>Stop</span>
        </ng-container>
      </button>
      <button (click)="seeDetails()" mat-menu-item>
        <mat-icon>list</mat-icon>
        <span>Details</span>
      </button>
      <button (click)="remove()" mat-menu-item>
        <mat-icon>delete</mat-icon>
        <span>Remove</span>
      </button>
      <button *ngIf="electronService.isElectronApp" (click)="open()" mat-menu-item>
        <mat-icon>open_in_new</mat-icon>
        <span>Download Location</span>
      </button>
    </mat-menu>
  `
})
export class MenuRendererComponent implements OnInit, OnDestroy, AgRendererComponent {
  constructor(
    public dialog: MatDialog,
    private httpClient: HttpClient,
    private breakpointObserver: BreakpointObserver,
    private wsConnectionService: WsConnectionService,
    private serverService: ServerService,
    private zone: NgZone,
    private _snackBar: MatSnackBar,
    public electronService: ElectronService
  ) {
    this.websocketHandlerPromise = this.wsConnectionService.getConnection();
    if (this.electronService.isElectronApp) {
      this.fs = this.electronService.remote.require('fs');
    }
  }

  isExtraSmall: Observable<BreakpointState> = this.breakpointObserver.observe(Breakpoints.XSmall);

  params: ICellRendererParams;

  postData: PostState;

  subscription: Subscription;

  websocketHandlerPromise: Promise<WsHandler>;

  fs;

  ngOnInit(): void {
    this.websocketHandlerPromise.then((handler: WsHandler) => {
      this.subscription = handler.subscribeForPosts(e => {
        this.zone.run(() => {
          e.forEach(v => {
            if (this.postData.postId === v.postId) {
              this.postData = v;
            }
          });
        });
      });
    });
  }

  ngOnDestroy(): void {
    if (this.subscription != null) {
      this.subscription.unsubscribe();
    }
  }

  seeDetails() {
    const dialogRef = this.dialog.open(PostDetailComponent, {
      width: '90%',
      height: '90%',
      maxWidth: '100vw',
      maxHeight: '100vh',
      data: this.postData
    });

    const smallDialogSubscription = this.isExtraSmall.subscribe(result => {
      if (result.matches) {
        dialogRef.updateSize('100%', '100%');
      } else {
        dialogRef.updateSize('90%', '90%');
      }
    });

    dialogRef.afterClosed().subscribe(() => {
      if (smallDialogSubscription != null) {
        smallDialogSubscription.unsubscribe();
      }
    });
  }

  restart() {
    this.httpClient.post(this.serverService.baseUrl + '/post/restart', { postId: this.postData.postId }).subscribe(
      () => {
        this._snackBar.open('Download started', null, {
          duration: 5000
        });
      },
      error => {
        console.error(error);
      }
    );
  }

  remove() {
    this.dialog
      .open(ConfirmDialogComponent, {
        maxHeight: '100vh',
        maxWidth: '100vw',
        height: '200px',
        width: '60%',
        data: { header: 'Confirmation', content: 'Are you sure you want to remove this item ?' }
      })
      .afterClosed()
      .pipe(
        filter(e => e === 'yes'),
        flatMap(e =>
          this.httpClient.post<RemoveResponse>(this.serverService.baseUrl + '/post/remove', {
            postId: this.postData.postId
          })
        )
      )
      .subscribe(
        data => {
          const toRemove = [];
          const nodeToDelete = this.params.api.getRowNode(data.postId);
          if (nodeToDelete != null) {
            toRemove.push(nodeToDelete.data);
          }
          this.params.api.updateRowData({ remove: toRemove });
        },
        error => {
          console.error(error);
        }
      );
  }

  open() {
    if (!this.electronService.isElectronApp) {
      console.error('Cannot open downloader folder, not electron app');
      return;
    }
    // Request the server to give the correct file location
    this.httpClient.get<DownloadPath>(this.serverService.baseUrl + '/post/path/' + this.postData.postId).subscribe(
      path => {
        if (this.fs.existsSync(path.path)) {
          this.electronService.shell.openItem(path.path);
        } else {
          if(this.postData.done <= 0) {
            this._snackBar.open('Download has not been started yet for this post', null, {
              duration: 5000
            });
          } else {
            this._snackBar.open(path.path + ' does not exist, you probably removed it', null, {
              duration: 5000
            });
          }
        }
      },
      error => {
        console.error(error);
      }
    );
  }

  stop() {
    this.httpClient.post(this.serverService.baseUrl + '/post/stop', { postId: this.postData.postId }).subscribe(
      () => {
        this._snackBar.open('Download stopped', null, {
          duration: 5000
        });
      },
      error => {
        console.error(error);
      }
    );
  }

  agInit(params: ICellRendererParams): void {
    this.params = params;
    this.postData = params.data;
  }

  refresh(params: ICellRendererParams): boolean {
    return false;
  }
}
