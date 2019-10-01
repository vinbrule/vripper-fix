import { VRPostParse, VRThreadParseState } from './../common/vr-post-parse.model';
import { Component, OnInit, NgZone, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { MatSnackBar } from '@angular/material';
import { GridOptions } from 'ag-grid-community';
import { UrlRendererComponent } from './url-renderer.component';
import { WsHandler } from '../ws-handler';
import { Subscription } from 'rxjs';
import { WSMessage } from '../common/ws-message.model';
import { CMD } from '../common/cmd.enum';
import { WsConnectionService } from '../ws-connection.service';
import { HttpClient } from '@angular/common/http';
import { ServerService } from '../server-service';

@Component({
  selector: 'app-multi-post',
  templateUrl: './multi-post.component.html',
  styleUrls: ['./multi-post.component.scss']
})
export class MultiPostComponent implements OnInit, OnDestroy {

  @Input()
  threadId: string;

  @Output()
  done: EventEmitter<boolean> = new EventEmitter();

  gridOptions: GridOptions;
  websocketHandlerPromise: Promise<WsHandler>;
  subscription: Subscription;
  loading = true;

  constructor(
    private ngZone: NgZone,
    private _snackBar: MatSnackBar,
    private wsConnectionService: WsConnectionService,
    private httpClient: HttpClient,
    private serverService: ServerService
  ) {
    this.websocketHandlerPromise = this.wsConnectionService.getConnection();
  }

  ngOnInit(): void {
    this.gridOptions = <GridOptions>{
      columnDefs: [
        {
          headerName: 'Number',
          field: 'number',
          cellClass: 'no-padding',
          maxWidth: 100,
          checkboxSelection: true,
          headerCheckboxSelection: true,
          headerCheckboxSelectionFilteredOnly: false,
          sort: 'asc'
        },
        {
          headerName: 'Title',
          field: 'title',
          cellClass: 'no-padding'
        },
        {
          headerName: 'URL',
          field: 'url',
          cellClass: 'no-padding',
          cellRenderer: 'urlCellRenderer'
        }
      ],
      defaultColDef: {
        sortable: true
      },
      frameworkComponents: {
        urlCellRenderer: UrlRendererComponent
      },
      rowSelection: 'multiple',
      rowMultiSelectWithClick: true,
      suppressRowClickSelection: true,
      rowHeight: 48,
      animateRows: true,
      rowData: [],
      overlayLoadingTemplate: '<span></span>',
      overlayNoRowsTemplate: '<span></span>',
      getRowNodeId: data => data['url'],
      onGridReady: () => {
        this.gridOptions.api.sizeColumnsToFit();
        this.connect();
      },
      onGridSizeChanged: () => this.gridOptions.api.sizeColumnsToFit(),
      onRowDataUpdated: () => this.gridOptions.api.sizeColumnsToFit()
    };
  }

  ngOnDestroy() {
    this.unsubscribe();
  }

  search(event) {
    this.gridOptions.api.setQuickFilter(event);
  }

  private unsubscribe() {
    if (this.subscription != null) {
      this.subscription.unsubscribe();
    }
    this.websocketHandlerPromise.then((handler: WsHandler) => {
      handler.send(new WSMessage(CMD.THREAD_PARSING_UNSUB.toString()));
    });
  }

  connect() {
    this.websocketHandlerPromise.then((handler: WsHandler) => {
      console.log('Connecting to thread parsing');
      this.subscription = handler.subscribeForThreadParsing(
        (states: Array<VRThreadParseState>, data: Array<VRPostParse>) => {
          if (data[0].threadId === this.threadId) {
            this.gridOptions.api.updateRowData({ add: data });
          }

          if (states.length > 0 && states[states.length - 1].state === 'END' && states[0].threadId === this.threadId) {
            this.ngZone.run(() => {
              this.loading = false;
              if (this.gridOptions.api.getDisplayedRowCount() === 1) {
                this.addPosts(
                  [this.gridOptions.api.getDisplayedRowAtIndex(0).data].map(e => ({
                    threadId: e.threadId,
                    postId: e.postId
                  }))
                );
                this.done.emit(true);
              }
            });
          }
        }
      );
      handler.send(new WSMessage(CMD.THREAD_PARSING_SUB.toString(), this.threadId));
    });
  }

  submit() {
    const data = (<VRPostParse[]>this.gridOptions.api.getSelectedRows()).map(e => ({
      postId: e.postId,
      threadId: this.threadId
    }));
    this.addPosts(data);
  }

  addPosts(data: { postId: string; threadId: string }[]) {
    this.httpClient.post(this.serverService.baseUrl + '/post/add', data).subscribe(
      () => {
        this._snackBar.open('Adding posts to queue', null, {
          duration: 5000
        });
        this.done.emit();
      },
      error => {
        this._snackBar.open(error.error, null, {
          duration: 5000
        });
      }
    );
  }
}